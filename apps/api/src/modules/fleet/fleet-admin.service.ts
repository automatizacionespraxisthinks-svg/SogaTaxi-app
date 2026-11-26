import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CampoExtra, VehicleType } from '@tax/shared';
import {
  ACTIVE_RIDE_STATUSES,
  MAX_CAMPOS_EXTRA,
  finDeSuspension,
  sigueSuspendido,
  valorDeCampoExtraValido,
} from '@tax/shared';
import { DB, type Database } from '../../db/db.module';
import {
  camposExtra,
  driverDevices,
  driverPositions,
  drivers,
  driverShifts,
  rideOffers,
  rides,
  vehicleDrivers,
  vehicles,
} from '../../db/schema';
import { AppError } from '../../common/problem';
import { isUniqueViolation } from '../../common/pg-errors';
import { documentHash, encryptColumn, hashSecret } from '../../common/crypto';
import { loadEnv } from '../../config/env';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { FleetService } from './fleet.service';

/**
 * Alta y mantenimiento de la flota desde la oficina (§6, §8.1).
 *
 * Hasta aquí los conductores solo se podían crear por terminal, lo que sirve
 * para arrancar con cinco y no para que la oficina opere sola con sesenta y
 * dos. Esto es lo mismo, pero con la sesión del administrador detrás y, sobre
 * todo, dejando rastro: dar de alta a una persona, cambiarle el PIN o
 * revocarle el celular son operaciones sobre datos de personas y tienen que
 * poder demostrarse después.
 *
 * El PIN nunca viaja de vuelta salvo en el momento de generarlo. No hay
 * «ver PIN»: en la base solo existe su hash Argon2, así que la única opción
 * cuando un conductor lo olvida es generarle otro.
 */

export interface AdminActor {
  /** Ausente cuando la operación viene del servidor y no de una persona. */
  id?: string;
  name: string;
  role: string;
  ip?: string;
}

export interface NuevoConductor {
  code: string;
  name: string;
  phone: string;
  /**
   * Los vehículos que podrá manejar, elegidos de los dados de alta
   * (18/11/2026). Es lo que usa el panel.
   */
  vehicleIds?: string[];
  /**
   * La forma de antes: una placa escrita, que crea el vehículo si no existe.
   * Se mantiene para los scripts y pruebas que la usan.
   */
  plate?: string;
  vehicleType?: VehicleType;
}

export interface NuevoVehiculo {
  plate: string;
  internalNumber?: string;
  type: VehicleType;
  capacity?: number;
}

export interface CambiosVehiculo {
  /** Corregir la placa: se digitó mal, o el carro cambió de placa. */
  plate?: string;
  internalNumber?: string | null;
  type?: VehicleType;
  capacity?: number;
  active?: boolean;
  brand?: string | null;
  modelYear?: number | null;
  ownerName?: string | null;
  /** `AAAA-MM-DD`, o nulo para borrarla. */
  soatExpiresOn?: string | null;
  rtoExpiresOn?: string | null;
  /** Campos adicionales, por id del campo; vacío borra el valor. */
  extra?: Record<string, string>;
}

export interface CambiosConductor {
  name?: string;
  phone?: string | null;
  active?: boolean;
  esPrueba?: boolean;
  aceptaPagoElectronico?: boolean;
  /** La cédula, solo dígitos. No se puede dejar vacía una vez puesta. */
  cedula?: string;
  /** `AAAA-MM-DD`, o nulo para borrarla. */
  licenseExpiresOn?: string | null;
  licenseRestriction?: string | null;
  /** Campos adicionales, por id del campo; vacío borra el valor. */
  extra?: Record<string, string>;
}

const capacidadPorTipo = (tipo: VehicleType) => (tipo === 'van' ? 8 : tipo === 'camioneta' ? 5 : 4);

@Injectable()
export class FleetAdminService {
  private readonly logger = new Logger(FleetAdminService.name);

  /*
   * `AuditService` se inyecta por token explícito, no por tipo. Nest resuelve
   * los tipos leyendo los metadatos que emite el compilador, y `tsx` —con el
   * que se ejecutan los comandos de `cli/` en desarrollo— no los emite: el
   * servicio llegaba `undefined` y el alta fallaba al escribir en la
   * bitácora. Compilado funcionaba; en desarrollo no.
   */
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FleetService) private readonly fleet: FleetService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  /* ------------------------------------------------------------- altas */

  /**
   * Da de alta un conductor y, si su placa no existía, también el vehículo.
   *
   * Devuelve el PIN una sola vez. Quien lo cree tiene que hacérselo llegar
   * por un canal distinto del que usa el conductor para su código: el código
   * circula entre compañeros y la placa es pública, así que el PIN es lo
   * único que de verdad autentica.
   */
  async createDriver(
    input: NuevoConductor,
    actor: AdminActor,
  ): Promise<{ id: string; code: string; pin: string }> {
    const code = input.code.trim();
    if (!input.vehicleIds?.length && !input.plate?.trim()) {
      throw new AppError('VALIDATION_FAILED', 'Elige al menos un vehículo que pueda manejar.');
    }

    // Cuatro dígitos: se teclea con guantes a las cinco de la mañana. Lo que
    // lo protege no es la longitud sino el bloqueo a los cinco intentos.
    const pin = String(randomInt(1000, 10000));
    const id = uuidv7();

    try {
      await this.db.transaction(async (tx) => {
        let vehicleIds = [...new Set(input.vehicleIds ?? [])];
        if (!vehicleIds.length) {
          const plate = input.plate!.trim().toUpperCase();
          const tipo = input.vehicleType ?? 'sedan';
          const [vehiculo] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.plate, plate)).limit(1);
          const vehicleId = vehiculo?.id ?? uuidv7();
          if (!vehiculo) {
            await tx.insert(vehicles).values({ id: vehicleId, plate, type: tipo, capacity: capacidadPorTipo(tipo) });
          }
          vehicleIds = [vehicleId];
        }

        await tx.insert(drivers).values({
          id,
          code,
          name: input.name.trim(),
          phone: input.phone.trim(),
          pinHash: await hashSecret(pin),
        });

        const placas = await this.vincular(tx as unknown as Database, id, vehicleIds);

        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: 'Dio de alta un conductor',
            entity: 'drivers',
            entityId: code,
            // Nunca el PIN, ni siquiera su hash: la bitácora se lee.
            after: { code, name: input.name.trim(), vehiculosPermitidos: placas },
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'drivers_code_key')) {
        // Los códigos de conductores eliminados siguen ocupados: nombran a
        // esa persona en sus carreras pasadas y no se reasignan.
        throw new AppError(
          'VALIDATION_FAILED',
          `El código ${code} ya está en uso o perteneció a un conductor eliminado. Usa otro.`,
        );
      }
      throw error;
    }

    this.logger.log({ code, actor: actor.name }, 'Conductor dado de alta');
    return { id, code, pin };
  }

  /* ------------------------------------------------------------ cambios */

  /**
   * Cambia los datos de un conductor: nombre, teléfono, cédula, licencia,
   * campos adicionales, si sigue trabajando o si es una cuenta de prueba.
   *
   * La cédula se guarda cifrada y en la bitácora no queda: solo que se cambió.
   */
  async updateDriver(driverId: string, cambios: CambiosConductor, actor: AdminActor): Promise<void> {
    await this.exigirVigente(driverId);
    const [antes] = await this.db
      .select({
        code: drivers.code,
        name: drivers.name,
        phone: drivers.phone,
        active: drivers.active,
        esPrueba: drivers.esPrueba,
        aceptaPagoElectronico: drivers.aceptaPagoElectronico,
        licenseExpiresOn: drivers.licenseExpiresOn,
        licenseRestriction: drivers.licenseRestriction,
        extra: drivers.extra,
      })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!antes) throw new AppError('NOT_FOUND', 'El conductor no existe');

    const despues = {
      name: cambios.name?.trim() ?? antes.name,
      phone: cambios.phone?.trim() ?? antes.phone,
      active: cambios.active ?? antes.active,
      esPrueba: cambios.esPrueba ?? antes.esPrueba,
      aceptaPagoElectronico: cambios.aceptaPagoElectronico ?? antes.aceptaPagoElectronico,
      licenseExpiresOn: cambios.licenseExpiresOn === undefined ? antes.licenseExpiresOn : cambios.licenseExpiresOn,
      licenseRestriction:
        cambios.licenseRestriction === undefined ? antes.licenseRestriction : cambios.licenseRestriction?.trim() || null,
      extra: cambios.extra ? await this.extraValidado('conductor', antes.extra, cambios.extra) : antes.extra,
    };
    // La cédula va aparte: cifrada, con su huella para no repetirla.
    const clave = loadEnv().ENCRYPTION_KEY;
    const cedula = cambios.cedula?.replace(/\D/g, '');
    const documento = cedula
      ? { documentEncrypted: encryptColumn(clave, cedula), documentHash: documentHash(clave, cedula) }
      : {};
    const accion =
      despues.active === false && antes.active
        ? 'Desactivó un conductor'
        : despues.esPrueba !== antes.esPrueba
          ? despues.esPrueba
            ? 'Marcó un conductor como cuenta de prueba'
            : 'Quitó la marca de prueba a un conductor'
          : despues.aceptaPagoElectronico !== antes.aceptaPagoElectronico
            ? despues.aceptaPagoElectronico
              ? 'Habilitó los pagos electrónicos a un conductor'
              : 'Quitó los pagos electrónicos a un conductor'
            : 'Editó un conductor';

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(drivers)
          .set({ ...despues, ...documento, updatedAt: new Date() })
          .where(eq(drivers.id, driverId));

        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: accion,
            entity: 'drivers',
            entityId: antes.code,
            before: antes,
            // La cédula no queda en la bitácora: solo que se cambió.
            after: cedula ? { ...despues, cedula: 'actualizada' } : despues,
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'drivers_document_hash_key')) {
        throw new AppError('VALIDATION_FAILED', 'Esa cédula ya es de otro conductor.');
      }
      throw error;
    }

    /*
     * Desactivar no interrumpe una carrera en curso, y es deliberado: dejar a
     * un pasajero a mitad de camino sería peor que el motivo por el que se
     * desactiva. Lo que sí hace, de inmediato, es sacarlo de las oleadas,
     * porque `findCandidates` exige `active = true`.
     */
  }

  /* --------------------------------------------------------- suspensión */

  /**
   * Suspende a un conductor por `dias` días contados desde ahora, por una
   * falla al reglamento interno.
   *
   * Es la desactivación con fecha de vuelta: sale de las oleadas al momento,
   * no entra a la PWA ni abre turno, y al cumplirse vuelve solo. Si estaba
   * en turno sin carrera, se le cierra y su teléfono se entera; si estaba
   * haciendo una, la termina y el turno se le cierra al finalizarla. Una
   * suspensión nueva reemplaza a la que hubiera: la oficina pone la fecha
   * que vale, no se suman.
   */
  async suspender(
    driverId: string,
    { dias, motivo }: { dias: number; motivo: string },
    actor: AdminActor,
  ): Promise<{ hasta: Date }> {
    await this.exigirVigente(driverId);
    const [antes] = await this.db
      .select({ code: drivers.code, hasta: drivers.suspendidoHasta })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!antes) throw new AppError('NOT_FOUND', 'El conductor no existe');

    const hasta = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    await this.db.transaction(async (tx) => {
      await tx
        .update(drivers)
        .set({ suspendidoHasta: hasta, motivoSuspension: motivo.trim(), updatedAt: new Date() })
        .where(eq(drivers.id, driverId));

      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: `Suspendió un conductor por ${dias} ${dias === 1 ? 'día' : 'días'}`,
          entity: 'drivers',
          entityId: antes.code,
          before: sigueSuspendido(antes.hasta) ? { hasta: antes.hasta!.toISOString() } : undefined,
          after: { hasta: hasta.toISOString(), motivo: motivo.trim() },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });

    if (!(await this.fleet.tieneCarreraActiva(driverId)) && (await this.hasOpenShift(driverId))) {
      await this.fleet.closeShift(driverId);
      this.realtime.turnoCerrado(
        driverId,
        `La oficina te suspendió hasta el ${finDeSuspension(hasta)}: tu turno quedó cerrado.`,
      );
    }

    this.logger.log({ code: antes.code, dias, actor: actor.name }, 'Conductor suspendido');
    return { hasta };
  }

  /** Levanta la suspensión antes de tiempo: vuelve a poder trabajar ya. */
  async levantarSuspension(driverId: string, actor: AdminActor): Promise<void> {
    const [antes] = await this.db
      .select({ code: drivers.code, hasta: drivers.suspendidoHasta, motivo: drivers.motivoSuspension })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!antes) throw new AppError('NOT_FOUND', 'El conductor no existe');
    if (!sigueSuspendido(antes.hasta)) return;

    await this.db.transaction(async (tx) => {
      await tx
        .update(drivers)
        .set({ suspendidoHasta: null, motivoSuspension: null, updatedAt: new Date() })
        .where(eq(drivers.id, driverId));

      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: 'Levantó la suspensión de un conductor',
          entity: 'drivers',
          entityId: antes.code,
          before: { hasta: antes.hasta!.toISOString() },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });
  }

  /**
   * Genera un PIN nuevo. No existe «ver el actual»: solo vive su hash.
   */
  async resetPin(driverId: string, actor: AdminActor): Promise<{ code: string; pin: string }> {
    await this.exigirVigente(driverId);
    const [conductor] = await this.db
      .select({ code: drivers.code })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!conductor) throw new AppError('NOT_FOUND', 'El conductor no existe');

    const pin = String(randomInt(1000, 10000));

    await this.db.transaction(async (tx) => {
      await tx
        .update(drivers)
        .set({
          pinHash: await hashSecret(pin),
          // Un PIN nuevo levanta el bloqueo: si estaba bloqueado por intentos
          // fallidos, lo más probable es que lo hubiera olvidado.
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(drivers.id, driverId));

      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: 'Reinició el PIN de un conductor',
          entity: 'drivers',
          entityId: conductor.code,
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });

    return { code: conductor.code, pin };
  }

  /* -------------------------------------------------------- dispositivos */

  /** Celulares registrados de un conductor, el más reciente primero. */
  async listDevices(driverId: string) {
    return this.db
      .select({
        id: driverDevices.id,
        label: driverDevices.label,
        lastSeenAt: driverDevices.lastSeenAt,
        createdAt: driverDevices.createdAt,
        revokedAt: driverDevices.revokedAt,
        pushSubscription: driverDevices.pushSubscription,
      })
      .from(driverDevices)
      .where(eq(driverDevices.driverId, driverId))
      .orderBy(desc(driverDevices.createdAt));
  }

  /**
   * Revoca un celular perdido (§8.1).
   *
   * Es lo primero que la oficina necesita un domingo: el token deja de valer
   * en la siguiente petición y, como la suscripción de push vive en la misma
   * fila, el teléfono también deja de recibir ofertas.
   */
  async revokeDevice(deviceId: string, actor: AdminActor): Promise<void> {
    const [dispositivo] = await this.db
      .select({
        id: driverDevices.id,
        label: driverDevices.label,
        revokedAt: driverDevices.revokedAt,
        code: drivers.code,
        driverId: drivers.id,
      })
      .from(driverDevices)
      .innerJoin(drivers, eq(drivers.id, driverDevices.driverId))
      .where(eq(driverDevices.id, deviceId))
      .limit(1);

    if (!dispositivo) throw new AppError('NOT_FOUND', 'El dispositivo no existe');
    if (dispositivo.revokedAt) return;

    await this.db.transaction(async (tx) => {
      await tx
        .update(driverDevices)
        .set({ revokedAt: new Date(), pushSubscription: null })
        .where(eq(driverDevices.id, deviceId));

      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: 'Revocó un dispositivo',
          entity: 'driver_devices',
          entityId: dispositivo.code,
          after: { label: dispositivo.label },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });

    // Sin esto el celular seguía recibiendo ofertas por el socket abierto.
    await this.realtime.cerrarSesionDe(
      dispositivo.driverId,
      deviceId,
      'La oficina cerró tu sesión en este celular. Si es un error, llama a la oficina.',
    );
    this.logger.log({ code: dispositivo.code, actor: actor.name }, 'Dispositivo revocado');
  }

  /* ---------------------------------------------------------- eliminar */

  /**
   * Elimina un conductor (18/11/2026).
   *
   * Si nunca trabajó —sin carreras, ofertas, turnos ni posiciones— se borra
   * la fila entera: no hay historial que proteger. Si trabajó, la fila se
   * queda porque sus carreras la nombran, pero se le quita todo lo que lo
   * identifica fuera de ese historial: cédula, teléfono, licencia y PIN. El
   * nombre y el código se conservan para que una carrera vieja se siga
   * leyendo, y el código no se reasigna.
   *
   * En los dos casos sale de Flota y de las oleadas, sus celulares quedan
   * revocados y su sesión se corta. Con una carrera en curso no se puede:
   * primero hay que terminarla o cancelarla, para no dejar a un pasajero a
   * mitad de camino sin conductor en el sistema.
   *
   * Queda en la bitácora quién lo hizo, cuándo, desde qué IP y por qué.
   */
  async eliminarDriver(
    driverId: string,
    { motivo, confirmacion }: { motivo: string; confirmacion: string },
    actor: AdminActor,
  ): Promise<{ code: string; modo: 'borrado' | 'baja' }> {
    const resultado = await this.db.transaction(async (tx) => {
      const [conductor] = await tx
        .select({ code: drivers.code, name: drivers.name, eliminadoAt: drivers.eliminadoAt })
        .from(drivers)
        .where(eq(drivers.id, driverId))
        .for('update')
        .limit(1);
      if (!conductor) throw new AppError('NOT_FOUND', 'El conductor no existe');
      if (conductor.eliminadoAt) throw new AppError('VALIDATION_FAILED', 'Este conductor ya fue eliminado');
      // La confirmación también se comprueba aquí: un botón en la interfaz no
      // protege de una llamada directa a la API ni de un id equivocado.
      if (confirmacion.trim() !== conductor.code) {
        throw new AppError('VALIDATION_FAILED', `Para confirmar escribe el código del conductor (${conductor.code}).`);
      }

      const [activa] = await tx
        .select({ code: rides.code })
        .from(rides)
        .where(and(eq(rides.driverId, driverId), inArray(rides.status, ACTIVE_RIDE_STATUSES)))
        .limit(1);
      if (activa) {
        throw new AppError(
          'DRIVER_BUSY',
          `Tiene la carrera ${activa.code} en curso. Espera a que termine o cancélala antes de eliminarlo.`,
        );
      }

      const historial = await this.tieneHistorial(tx as unknown as Database, driverId);
      const dispositivos = await tx
        .select({ id: driverDevices.id })
        .from(driverDevices)
        .where(and(eq(driverDevices.driverId, driverId), isNull(driverDevices.revokedAt)));

      // Su turno abierto, si lo había, se cierra: sin conductor no hay turno.
      await tx
        .update(driverShifts)
        .set({ endedAt: new Date() })
        .where(and(eq(driverShifts.driverId, driverId), isNull(driverShifts.endedAt)));
      const retiradas = await tx
        .update(rideOffers)
        .set({ response: 'revoked', revokedAt: new Date() })
        .where(and(eq(rideOffers.driverId, driverId), eq(rideOffers.response, 'pending')))
        .returning({ rideId: rideOffers.rideId });

      const modo: 'borrado' | 'baja' = historial ? 'baja' : 'borrado';

      if (modo === 'borrado') {
        // Los vínculos con los móviles se van solos (en cascada); los
        // celulares no, porque guardan el historial de accesos.
        await tx.delete(driverDevices).where(eq(driverDevices.driverId, driverId));
        await tx.delete(drivers).where(eq(drivers.id, driverId));
      } else {
        await tx
          .update(driverDevices)
          .set({ revokedAt: new Date(), pushSubscription: null })
          .where(and(eq(driverDevices.driverId, driverId), isNull(driverDevices.revokedAt)));
        // Deja de figurar como conductor o relevador de cualquier móvil.
        await tx.delete(vehicleDrivers).where(eq(vehicleDrivers.driverId, driverId));
        await tx
          .update(drivers)
          .set({
            active: false,
            status: 'OFF_SHIFT',
            eliminadoAt: new Date(),
            documentEncrypted: null,
            documentHash: null,
            phone: null,
            licenseExpiresOn: null,
            licenseRestriction: null,
            // No es un hash válido: ningún PIN puede coincidir con él.
            pinHash: '!eliminado',
            suspendidoHasta: null,
            motivoSuspension: null,
            failedAttempts: 0,
            lockedUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(drivers.id, driverId));
      }

      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: 'Eliminó un conductor',
          entity: 'drivers',
          entityId: conductor.code,
          // Ni cédula ni teléfono: la bitácora se lee, y se acaban de borrar.
          before: { code: conductor.code, name: conductor.name },
          after: {
            motivo: motivo.trim(),
            modo,
            conservaHistorial: modo === 'baja',
            celularesRevocados: dispositivos.length,
          },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );

      return { code: conductor.code, modo, dispositivos, retiradas };
    });

    // Fuera de la transacción: avisos a los sockets y limpieza de Redis.
    for (const { rideId } of resultado.retiradas) this.realtime.retirarOfertaDe(driverId, rideId);
    for (const { id } of resultado.dispositivos) {
      await this.realtime.cerrarSesionDe(driverId, id, 'La oficina dio de baja tu cuenta. Para cualquier duda, llama a la oficina.');
    }
    await this.fleet.olvidarPosicion(driverId);

    this.logger.log({ code: resultado.code, modo: resultado.modo, actor: actor.name }, 'Conductor eliminado');
    return { code: resultado.code, modo: resultado.modo };
  }

  /** Si ya trabajó: con carreras, ofertas, turnos o posiciones que lo nombran. */
  private async tieneHistorial(db: Database, driverId: string): Promise<boolean> {
    const [fila] = await db.execute<{ hay: boolean }>(sql`
      select exists(select 1 from ${rides} where ${rides.driverId} = ${driverId})
          or exists(select 1 from ${rideOffers} where ${rideOffers.driverId} = ${driverId})
          or exists(select 1 from ${driverShifts} where ${driverShifts.driverId} = ${driverId})
          or exists(select 1 from ${driverPositions} where ${driverPositions.driverId} = ${driverId})
        as hay
    `).then((r) => r.rows);
    return Boolean(fila?.hay);
  }

  /** Las operaciones de gestión no aplican a un conductor eliminado. */
  private async exigirVigente(driverId: string): Promise<void> {
    const [fila] = await this.db
      .select({ eliminadoAt: drivers.eliminadoAt })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);
    if (!fila) throw new AppError('NOT_FOUND', 'El conductor no existe');
    if (fila.eliminadoAt) throw new AppError('VALIDATION_FAILED', 'Este conductor fue eliminado');
  }

  /* ---------------------------------------------- vehículos permitidos */

  /**
   * Fija los vehículos que un conductor puede manejar (18/11/2026): solo
   * podrá abrir turno o cambiar de carro dentro de estos.
   *
   * Lo que no está en la lista nueva se le quita, venga del listado maestro
   * o del panel; lo nuevo queda como asignado en el panel, que la siguiente
   * carga del listado no borra. Si se le quita el carro en el que está en
   * turno sin carrera, el turno se le cierra y su celular se entera.
   */
  async fijarVehiculos(driverId: string, vehicleIds: string[], actor: AdminActor): Promise<{ placas: string[] }> {
    await this.exigirVigente(driverId);
    const deseados = [...new Set(vehicleIds)];

    const { code, antes, placas } = await this.db.transaction(async (tx) => {
      const [conductor] = await tx.select({ code: drivers.code }).from(drivers).where(eq(drivers.id, driverId)).limit(1);
      const actuales = await tx
        .select({ id: vehicleDrivers.id, vehicleId: vehicleDrivers.vehicleId, plate: vehicles.plate })
        .from(vehicleDrivers)
        .innerJoin(vehicles, eq(vehicles.id, vehicleDrivers.vehicleId))
        .where(eq(vehicleDrivers.driverId, driverId));

      const quitar = actuales.filter((v) => !deseados.includes(v.vehicleId));
      if (quitar.length) {
        await tx.delete(vehicleDrivers).where(inArray(vehicleDrivers.id, quitar.map((v) => v.id)));
      }
      const nuevos = deseados.filter((id) => !actuales.some((v) => v.vehicleId === id));
      await this.vincular(tx as unknown as Database, driverId, nuevos);

      const placas = deseados.length
        ? (await tx.select({ plate: vehicles.plate }).from(vehicles).where(inArray(vehicles.id, deseados))).map((v) => v.plate).sort()
        : [];
      const antes = actuales.map((v) => v.plate).sort();

      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: 'Cambió los vehículos permitidos de un conductor',
          entity: 'drivers',
          entityId: conductor!.code,
          before: { vehiculos: antes },
          after: { vehiculos: placas },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
      return { code: conductor!.code, antes, placas };
    });

    // En turno en un carro que ya no tiene permitido: se le cierra, salvo
    // que vaya en carrera (la termina y el siguiente turno ya no podrá).
    const placaDelTurno = await this.fleet.placaDelTurno(driverId);
    if (placaDelTurno && !placas.includes(placaDelTurno) && !(await this.fleet.tieneCarreraActiva(driverId))) {
      await this.fleet.closeShift(driverId);
      this.realtime.turnoCerrado(
        driverId,
        `La oficina ya no te permite el móvil ${placaDelTurno}: tu turno quedó cerrado. Abre turno en uno de tus vehículos.`,
      );
    }

    this.logger.log({ code, antes, despues: placas, actor: actor.name }, 'Vehículos permitidos cambiados');
    return { placas };
  }

  /**
   * Crea los vínculos que faltan entre un conductor y unos vehículos, como
   * asignados en el panel. El primero que toma un carro sin titular queda de
   * conductor y los demás de relevadores, igual que en el listado maestro.
   * Devuelve las placas, para la bitácora.
   */
  private async vincular(db: Database, driverId: string, vehicleIds: string[]): Promise<string[]> {
    if (!vehicleIds.length) return [];
    const encontrados = await db
      .select({ id: vehicles.id, plate: vehicles.plate })
      .from(vehicles)
      .where(inArray(vehicles.id, vehicleIds));
    if (encontrados.length !== vehicleIds.length) {
      throw new AppError('VALIDATION_FAILED', 'Alguno de los vehículos elegidos no existe.');
    }
    for (const vehicleId of vehicleIds) {
      const [titular] = await db
        .select({ id: vehicleDrivers.id })
        .from(vehicleDrivers)
        .where(and(eq(vehicleDrivers.vehicleId, vehicleId), eq(vehicleDrivers.role, 'conductor')))
        .limit(1);
      await db
        .insert(vehicleDrivers)
        .values({ id: uuidv7(), vehicleId, driverId, role: titular ? 'relevador' : 'conductor', origen: 'panel' })
        .onConflictDoNothing();
    }
    return encontrados.map((v) => v.plate).sort();
  }

  /* --------------------------------------------------------- vehículos */

  /** Da de alta un vehículo. La placa y el número interno no se repiten. */
  async crearVehiculo(input: NuevoVehiculo, actor: AdminActor): Promise<{ id: string; plate: string }> {
    const id = uuidv7();
    const plate = input.plate.trim().toUpperCase().replace(/[\s-]/g, '');
    const internalNumber = input.internalNumber?.trim() || null;
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(vehicles).values({
          id,
          plate,
          internalNumber,
          type: input.type,
          capacity: input.capacity ?? capacidadPorTipo(input.type),
        });
        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: 'Dio de alta un vehículo',
            entity: 'vehicles',
            entityId: plate,
            after: { plate, internalNumber, type: input.type },
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'vehicles_plate_key')) {
        throw new AppError('VALIDATION_FAILED', `Ya existe un vehículo con la placa ${plate}.`);
      }
      if (isUniqueViolation(error, 'vehicles_internal_number_key')) {
        throw new AppError('VALIDATION_FAILED', `El número interno ${internalNumber} ya es de otro vehículo.`);
      }
      throw error;
    }
    return { id, plate };
  }

  /**
   * Cambia número interno, tipo, capacidad o si está activo. No se borra:
   * sus turnos y carreras lo siguen nombrando. Inactivo, nadie abre turno en
   * él aunque lo tenga permitido.
   */
  async editarVehiculo(vehicleId: string, cambios: CambiosVehiculo, actor: AdminActor): Promise<void> {
    const [antes] = await this.db
      .select({
        plate: vehicles.plate,
        internalNumber: vehicles.internalNumber,
        type: vehicles.type,
        capacity: vehicles.capacity,
        active: vehicles.active,
        brand: vehicles.brand,
        modelYear: vehicles.modelYear,
        ownerName: vehicles.ownerName,
        soatExpiresOn: vehicles.soatExpiresOn,
        rtoExpiresOn: vehicles.rtoExpiresOn,
        extra: vehicles.extra,
      })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);
    if (!antes) throw new AppError('NOT_FOUND', 'El vehículo no existe');

    // Lo que no viene se queda como estaba; lo que viene vacío o nulo se borra.
    const texto = (nuevo: string | null | undefined, actual: string | null) =>
      nuevo === undefined ? actual : nuevo?.trim() || null;
    const despues = {
      plate: cambios.plate?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || antes.plate,
      internalNumber: texto(cambios.internalNumber, antes.internalNumber),
      type: cambios.type ?? antes.type,
      capacity: cambios.capacity ?? antes.capacity,
      active: cambios.active ?? antes.active,
      brand: texto(cambios.brand, antes.brand),
      modelYear: cambios.modelYear === undefined ? antes.modelYear : cambios.modelYear,
      ownerName: texto(cambios.ownerName, antes.ownerName),
      soatExpiresOn: cambios.soatExpiresOn === undefined ? antes.soatExpiresOn : cambios.soatExpiresOn,
      rtoExpiresOn: cambios.rtoExpiresOn === undefined ? antes.rtoExpiresOn : cambios.rtoExpiresOn,
      extra: cambios.extra ? await this.extraValidado('vehiculo', antes.extra, cambios.extra) : antes.extra,
    };
    const accion =
      despues.active !== antes.active
        ? despues.active
          ? 'Activó un vehículo'
          : 'Desactivó un vehículo'
        : despues.plate !== antes.plate
          ? 'Corrigió la placa de un vehículo'
          : 'Editó un vehículo';

    try {
      await this.db.transaction(async (tx) => {
        await tx.update(vehicles).set({ ...despues, updatedAt: new Date() }).where(eq(vehicles.id, vehicleId));
        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: accion,
            entity: 'vehicles',
            entityId: antes.plate,
            before: antes,
            after: despues,
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'vehicles_internal_number_key')) {
        throw new AppError('VALIDATION_FAILED', `El número interno ${despues.internalNumber} ya es de otro vehículo.`);
      }
      if (isUniqueViolation(error, 'vehicles_plate_key')) {
        throw new AppError('VALIDATION_FAILED', `La placa ${despues.plate} ya es de otro vehículo.`);
      }
      throw error;
    }
  }

  /* --------------------------------------------------- campos adicionales */

  /** Los campos adicionales que definió la oficina, activos y desactivados. */
  async listarCamposExtra(): Promise<CampoExtra[]> {
    return this.db
      .select({
        id: camposExtra.id,
        entidad: camposExtra.entidad,
        nombre: camposExtra.nombre,
        tipo: camposExtra.tipo,
        activo: camposExtra.activo,
      })
      .from(camposExtra)
      .orderBy(camposExtra.entidad, camposExtra.createdAt);
  }

  async crearCampoExtra(
    input: { entidad: CampoExtra['entidad']; nombre: string; tipo: CampoExtra['tipo'] },
    actor: AdminActor,
  ): Promise<CampoExtra> {
    const delaEntidad = (await this.listarCamposExtra()).filter((c) => c.entidad === input.entidad && c.activo);
    if (delaEntidad.length >= MAX_CAMPOS_EXTRA) {
      throw new AppError('VALIDATION_FAILED', `Ya hay ${MAX_CAMPOS_EXTRA} campos adicionales: desactive uno antes de crear otro.`);
    }
    const campo: CampoExtra = { id: uuidv7(), entidad: input.entidad, nombre: input.nombre.trim(), tipo: input.tipo, activo: true };
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(camposExtra).values(campo);
        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: 'Creó un campo adicional',
            entity: 'campos_extra',
            entityId: `${campo.entidad}: ${campo.nombre}`,
            after: { tipo: campo.tipo },
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'campos_extra_nombre_key')) {
        throw new AppError('VALIDATION_FAILED', `Ya existe un campo «${campo.nombre}». Si está desactivado, actívelo de nuevo.`);
      }
      throw error;
    }
    return campo;
  }

  /** Cambia el nombre de un campo o lo desactiva. El tipo no se cambia: lo escrito dejaría de servir. */
  async cambiarCampoExtra(id: string, cambios: { nombre?: string; activo?: boolean }, actor: AdminActor): Promise<void> {
    const [antes] = await this.db.select().from(camposExtra).where(eq(camposExtra.id, id)).limit(1);
    if (!antes) throw new AppError('NOT_FOUND', 'Ese campo no existe');
    const despues = { nombre: cambios.nombre?.trim() || antes.nombre, activo: cambios.activo ?? antes.activo };
    try {
      await this.db.transaction(async (tx) => {
        await tx.update(camposExtra).set(despues).where(eq(camposExtra.id, id));
        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: despues.activo !== antes.activo ? (despues.activo ? 'Activó un campo adicional' : 'Desactivó un campo adicional') : 'Cambió el nombre de un campo adicional',
            entity: 'campos_extra',
            entityId: `${antes.entidad}: ${antes.nombre}`,
            before: { nombre: antes.nombre, activo: antes.activo },
            after: despues,
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'campos_extra_nombre_key')) {
        throw new AppError('VALIDATION_FAILED', `Ya existe un campo «${despues.nombre}».`);
      }
      throw error;
    }
  }

  /**
   * Los valores adicionales de una ficha tras aplicar los cambios: solo de
   * campos activos de esa entidad, con el formato de su tipo. Vacío borra.
   */
  private async extraValidado(
    entidad: CampoExtra['entidad'],
    actual: Record<string, string>,
    cambios: Record<string, string>,
  ): Promise<Record<string, string>> {
    const campos = new Map((await this.listarCamposExtra()).filter((c) => c.entidad === entidad && c.activo).map((c) => [c.id, c]));
    const resultado = { ...actual };
    for (const [id, valor] of Object.entries(cambios)) {
      const campo = campos.get(id);
      if (!campo) {
        // De un campo desactivado solo se rechaza escribir algo nuevo: lo que
        // la ficha ya traía viaja de vuelta tal cual y no es un cambio.
        if ((actual[id] ?? '') === valor.trim()) continue;
        throw new AppError('VALIDATION_FAILED', 'Uno de los campos adicionales ya no está en uso: recargue la página.');
      }
      if (!valorDeCampoExtraValido(campo.tipo, valor)) {
        throw new AppError('VALIDATION_FAILED', `«${campo.nombre}» no tiene un valor válido.`);
      }
      const limpio = valor.trim();
      if (limpio === '') delete resultado[id];
      else resultado[id] = limpio;
    }
    return resultado;
  }

  /* ----------------------------------------------------------- consultas */

  /**
   * Los vehículos dados de alta, cada uno con quiénes lo pueden manejar.
   *
   * `quienes` son los nombres (26/11/2026): antes solo iba la cuenta, y para
   * saber quién maneja un carro había que abrir conductor por conductor.
   */
  async listVehicles() {
    const filas = await this.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        internalNumber: vehicles.internalNumber,
        type: vehicles.type,
        capacity: vehicles.capacity,
        active: vehicles.active,
        brand: vehicles.brand,
        modelYear: vehicles.modelYear,
        ownerName: vehicles.ownerName,
        soatExpiresOn: vehicles.soatExpiresOn,
        rtoExpiresOn: vehicles.rtoExpiresOn,
        extra: vehicles.extra,
        /*
         * Cuántos conductores vigentes lo tienen permitido.
         *
         * Escrito a mano y con alias, no con las columnas de Drizzle: en una
         * consulta de una sola tabla Drizzle las escribe sin el nombre de la
         * tabla, y la subconsulta quedaba con `"id" = "driver_id"`, que
         * Postgres rechaza por ambiguo. Toda la lista de vehículos fallaba.
         */
        conductores: sql<number>`(
          select count(*)::int from vehicle_drivers vd
          join drivers d on d.id = vd.driver_id
          where vd.vehicle_id = "vehicles"."id" and d.eliminado_at is null
        )`,
      })
      .from(vehicles)
      .orderBy(vehicles.internalNumber, vehicles.plate);

    const vinculos = await this.db
      .select({
        vehicleId: vehicleDrivers.vehicleId,
        id: drivers.id,
        code: drivers.code,
        name: drivers.name,
        activo: drivers.active,
        rol: vehicleDrivers.role,
      })
      .from(vehicleDrivers)
      .innerJoin(drivers, eq(drivers.id, vehicleDrivers.driverId))
      .where(isNull(drivers.eliminadoAt))
      .orderBy(drivers.name);
    const porVehiculo = new Map<string, { id: string; code: string; name: string; activo: boolean; rol: string }[]>();
    for (const { vehicleId, ...quien } of vinculos) {
      porVehiculo.set(vehicleId, [...(porVehiculo.get(vehicleId) ?? []), quien]);
    }
    return filas.map((fila) => ({ ...fila, quienes: porVehiculo.get(fila.id) ?? [] }));
  }

  /** Si tiene turno abierto; la oficina lo necesita antes de desactivarlo. */
  async hasOpenShift(driverId: string): Promise<boolean> {
    const [fila] = await this.db
      .select({ id: driverShifts.id })
      .from(driverShifts)
      .where(and(eq(driverShifts.driverId, driverId), isNull(driverShifts.endedAt)))
      .limit(1);
    return Boolean(fila);
  }
}
