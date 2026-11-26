import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DB, DbModule, type Database } from '../db/db.module';
import { drivers, vehicleDrivers, vehicles } from '../db/schema';
import { documentHash, encryptColumn, hashSecret } from '../common/crypto';
import { loadEnv } from '../config/env';
import { AuditService } from '../modules/audit/audit.service';
import { leerAutocab, type PersonaDeAutocab } from '../modules/fleet/autocab';

/**
 * Carga inicial desde Autocab, el sistema anterior de la empresa: los carros,
 * los conductores y qué carros puede manejar cada uno (26/11/2026).
 *
 * Por defecto SIMULA: hace todo dentro de una transacción, la deshace e
 * informa lo que haría. Con `--aplicar` lo guarda. Se puede repetir: al carro
 * se le reconoce por la placa y a la persona por su cédula o su código, así
 * que lo que ya está se actualiza y nada se duplica. Lo que la oficina cambió
 * después en el panel —un PIN, un conductor desactivado— no se pisa.
 *
 *   node dist/cli/importar-autocab.js <Vehiculos.csv> <Conductores.csv>            # simula
 *   node dist/cli/importar-autocab.js <Vehiculos.csv> <Conductores.csv> --aplicar  # carga
 *
 * Opciones:
 *   --aplicar            guarda los cambios (sin esto, solo simula)
 *   --pendientes=<ruta>  CSV con lo que la oficina debe completar (sin cédula,
 *                        sin celular, sin carro, licencia vencida). No lleva PIN.
 *   --pines=<ruta>       CSV con el PIN de quienes NO lo traían de Autocab y
 *                        recibieron uno nuevo. Los demás entran con el suyo.
 *
 * Los conductores conservan el número y el PIN con que entraban en Autocab
 * («2006-1» pasa a ser el código 20061). El PIN se guarda cifrado; en el
 * informe no aparece ninguno que ya existiera.
 */

@Module({ imports: [DbModule], providers: [AuditService] })
class CliModule {}

const USO = 'Uso: importar-autocab.js <Vehiculos.csv> <Conductores.csv> [--aplicar] [--pendientes=ruta.csv] [--pines=ruta.csv]';

class Simulacion extends Error {}

interface Informe {
  vehiculos: { nuevos: number; actualizados: number; sinCambios: number; sinMovil: string[] };
  conductores: {
    nuevos: number;
    actualizados: number;
    sinCambios: number;
    desactivados: number;
    conPinNuevo: { codigo: string; nombre: string; pin: string | null }[];
  };
  vinculos: { nuevos: number; yaEstaban: number };
  pendientes: { codigo: string; nombre: string; falta: string[] }[];
}

const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const hoy = () => new Date().toISOString().slice(0, 10);

async function cargar(
  tx: Database,
  leido: ReturnType<typeof leerAutocab>,
  aplicar: boolean,
  clave: string,
): Promise<Informe> {
  const informe: Informe = {
    vehiculos: { nuevos: 0, actualizados: 0, sinCambios: 0, sinMovil: [] },
    conductores: { nuevos: 0, actualizados: 0, sinCambios: 0, desactivados: 0, conPinNuevo: [] },
    vinculos: { nuevos: 0, yaEstaban: 0 },
    pendientes: [],
  };

  /* ------------------------------------------------------------ carros --- */
  const carrosActuales = await tx.select().from(vehicles);
  const porPlaca = new Map(carrosActuales.map((v) => [v.plate, v]));
  const movilesUsados = new Map(carrosActuales.filter((v) => v.internalNumber).map((v) => [v.internalNumber!, v.plate]));
  const idDePlaca = new Map<string, string>();

  for (const v of leido.vehiculos) {
    // El móvil solo se pone si está libre: el índice no admite dos iguales.
    const duenoDelMovil = v.interno ? movilesUsados.get(v.interno) : undefined;
    const interno = v.interno && (!duenoDelMovil || duenoDelMovil === v.placa) ? v.interno : null;
    if (!interno) informe.vehiculos.sinMovil.push(v.placa);

    const valores = {
      internalNumber: interno,
      type: v.tipo,
      capacity: v.capacidad,
      brand: v.marca,
      modelYear: v.modelo,
      ownerName: v.propietario,
      soatExpiresOn: v.soatVence,
      rtoExpiresOn: v.tecnomecanicaVence,
    };
    const actual = porPlaca.get(v.placa);
    if (!actual) {
      const id = uuidv7();
      await tx.insert(vehicles).values({ id, plate: v.placa, ...valores });
      if (interno) movilesUsados.set(interno, v.placa);
      idDePlaca.set(v.placa, id);
      informe.vehiculos.nuevos += 1;
      continue;
    }
    idDePlaca.set(v.placa, actual.id);
    // Lo que Autocab no trae no borra lo que ya había.
    const cambios = Object.fromEntries(
      Object.entries(valores).filter(([campo, valor]) => valor !== null && !igual(actual[campo as keyof typeof actual], valor)),
    );
    if (Object.keys(cambios).length === 0) {
      informe.vehiculos.sinCambios += 1;
      continue;
    }
    await tx.update(vehicles).set({ ...cambios, updatedAt: new Date() }).where(eq(vehicles.id, actual.id));
    informe.vehiculos.actualizados += 1;
  }

  /* -------------------------------------------------------- conductores --- */
  const actuales = await tx
    .select({
      id: drivers.id,
      code: drivers.code,
      name: drivers.name,
      phone: drivers.phone,
      documentHash: drivers.documentHash,
      licenseExpiresOn: drivers.licenseExpiresOn,
      active: drivers.active,
    })
    .from(drivers);
  const porHuella = new Map(actuales.filter((d) => d.documentHash).map((d) => [d.documentHash!, d]));
  const porCodigo = new Map(actuales.map((d) => [d.code, d]));
  const codigosUsados = new Set(actuales.map((d) => d.code));
  for (const p of leido.personas) if (p.codigo) codigosUsados.add(p.codigo);
  let siguiente = 90001;
  const codigoNuevo = () => {
    while (codigosUsados.has(String(siguiente))) siguiente += 1;
    codigosUsados.add(String(siguiente));
    return String(siguiente);
  };

  const idDePersona = new Map<PersonaDeAutocab, string>();
  const reclamados = new Set<string>();
  for (const p of leido.personas) {
    const huella = p.cedula ? documentHash(clave, p.cedula) : null;
    let actual = (huella ? porHuella.get(huella) : undefined) ?? (p.codigo ? porCodigo.get(p.codigo) : undefined);
    // Un código que ya es de otra persona no se le quita.
    if (actual && reclamados.has(actual.id)) actual = undefined;

    const falta: string[] = [];
    if (!p.cedula) falta.push('cédula');
    if (!p.celular) falta.push('celular');
    if (p.carros.length === 0) falta.push('carro asignado');
    if (!p.licenciaVence) falta.push('vencimiento de la licencia');
    else if (p.licenciaVence < hoy()) falta.push(`licencia vencida (${p.licenciaVence})`);

    if (!actual) {
      const id = uuidv7();
      const codigo = p.codigo && !porCodigo.has(p.codigo) ? p.codigo : codigoNuevo();
      const pinNuevo = p.pin ? null : String(randomInt(1000, 10000));
      // Calcular 700 huellas de PIN tarda un par de minutos: en la simulación no hace falta.
      const pinHash = aplicar ? await hashSecret(p.pin ?? pinNuevo!) : 'simulación';
      await tx.insert(drivers).values({
        id,
        code: codigo,
        name: p.nombre,
        phone: p.celular,
        documentEncrypted: p.cedula ? encryptColumn(clave, p.cedula) : null,
        documentHash: huella,
        licenseExpiresOn: p.licenciaVence,
        pinHash,
        active: !p.suspendido,
      });
      if (pinNuevo) informe.conductores.conPinNuevo.push({ codigo, nombre: p.nombre, pin: aplicar ? pinNuevo : null });
      if (p.suspendido) informe.conductores.desactivados += 1;
      informe.conductores.nuevos += 1;
      idDePersona.set(p, id);
      reclamados.add(id);
      if (falta.length) informe.pendientes.push({ codigo, nombre: p.nombre, falta });
      continue;
    }

    reclamados.add(actual.id);
    idDePersona.set(p, actual.id);
    if (falta.length) informe.pendientes.push({ codigo: actual.code, nombre: p.nombre, falta });
    // Ni el PIN ni «activo» se tocan: son de la oficina desde la primera carga.
    const cambios: Record<string, unknown> = {};
    if (actual.name !== p.nombre) cambios.name = p.nombre;
    if (p.celular && actual.phone !== p.celular) cambios.phone = p.celular;
    if (p.licenciaVence && actual.licenseExpiresOn !== p.licenciaVence) cambios.licenseExpiresOn = p.licenciaVence;
    if (huella && !actual.documentHash) {
      cambios.documentEncrypted = encryptColumn(clave, p.cedula!);
      cambios.documentHash = huella;
    }
    if (Object.keys(cambios).length === 0) {
      informe.conductores.sinCambios += 1;
      continue;
    }
    await tx.update(drivers).set({ ...cambios, updatedAt: new Date() }).where(eq(drivers.id, actual.id));
    informe.conductores.actualizados += 1;
  }

  /* ------------------------------------------------------------ vínculos --- */
  const vinculosActuales = await tx.select().from(vehicleDrivers);
  const yaVinculados = new Set(vinculosActuales.map((v) => `${v.vehicleId}|${v.driverId}`));
  for (const p of leido.personas) {
    const driverId = idDePersona.get(p)!;
    for (const carro of p.carros) {
      const vehicleId = idDePlaca.get(carro.placa);
      if (!vehicleId) continue;
      if (yaVinculados.has(`${vehicleId}|${driverId}`)) {
        informe.vinculos.yaEstaban += 1;
        continue;
      }
      await tx.insert(vehicleDrivers).values({ id: uuidv7(), vehicleId, driverId, role: carro.rol, origen: 'listado' });
      yaVinculados.add(`${vehicleId}|${driverId}`);
      informe.vinculos.nuevos += 1;
    }
  }

  return informe;
}

const csv = (filas: string[][]) =>
  `﻿${filas.map((f) => f.map((v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';')).join('\n')}\n`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rutas = args.filter((a) => !a.startsWith('--'));
  const opcion = (nombre: string) => args.find((a) => a.startsWith(`--${nombre}=`))?.split('=').slice(1).join('=');
  const aplicar = args.includes('--aplicar');
  const conocidas = ['--aplicar', '--pendientes=', '--pines='];
  const desconocidas = args.filter((a) => a.startsWith('--') && !conocidas.some((c) => a === c || (c.endsWith('=') && a.startsWith(c))));
  if (rutas.length !== 2 || desconocidas.length) {
    console.error(desconocidas.length ? `Opción desconocida: ${desconocidas.join(', ')}\n${USO}` : USO);
    process.exitCode = 1;
    return;
  }

  const leido = leerAutocab(readFileSync(rutas[0]!, 'utf8'), readFileSync(rutas[1]!, 'utf8'));
  console.log(`Autocab: ${leido.vehiculos.length} carros y ${leido.personas.length} personas (una vez cada uno).`);
  if (leido.avisos.length) {
    console.log(`\nAvisos de los archivos (${leido.avisos.length}):`);
    for (const aviso of leido.avisos) console.log(`  · ${aviso}`);
  }

  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
  try {
    const db = app.get<Database>(DB);
    const clave = loadEnv().ENCRYPTION_KEY;
    let informe: Informe | undefined;
    try {
      await db.transaction(async (tx) => {
        informe = await cargar(tx as unknown as Database, leido, aplicar, clave);
        if (!aplicar) throw new Simulacion();
        await app.get(AuditService).record(
          {
            actorName: 'Carga desde Autocab',
            role: 'sistema',
            action: 'Cargó la flota desde Autocab',
            entity: 'drivers',
            entityId: `${basename(rutas[0]!)} + ${basename(rutas[1]!)}`,
            after: {
              vehiculos: { nuevos: informe.vehiculos.nuevos, actualizados: informe.vehiculos.actualizados },
              conductores: { nuevos: informe.conductores.nuevos, actualizados: informe.conductores.actualizados },
              vinculos: informe.vinculos.nuevos,
            },
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (!(error instanceof Simulacion)) throw error;
    }
    const i = informe!;

    console.log('\nCarros');
    console.log(`  nuevos        ${i.vehiculos.nuevos}`);
    console.log(`  actualizados  ${i.vehiculos.actualizados}`);
    console.log(`  sin cambios   ${i.vehiculos.sinCambios}`);
    if (i.vehiculos.sinMovil.length) console.log(`  sin número de móvil (ya lo tiene otro carro): ${i.vehiculos.sinMovil.join(', ')}`);

    console.log('\nConductores');
    console.log(`  nuevos        ${i.conductores.nuevos}`);
    console.log(`  actualizados  ${i.conductores.actualizados}`);
    console.log(`  sin cambios   ${i.conductores.sinCambios}`);
    console.log(`  cargados como desactivados (suspendidos en Autocab): ${i.conductores.desactivados}`);
    console.log(`  con PIN nuevo (no traían uno de Autocab): ${i.conductores.conPinNuevo.length}`);

    console.log(`\nCarros que puede manejar cada conductor: ${i.vinculos.nuevos} nuevos, ${i.vinculos.yaEstaban} ya estaban`);

    const cuenta = new Map<string, number>();
    for (const p of i.pendientes) for (const f of p.falta) {
      const clase = f.startsWith('licencia vencida') ? 'licencia vencida' : f;
      cuenta.set(clase, (cuenta.get(clase) ?? 0) + 1);
    }
    console.log(`\nPara completar en el panel (${i.pendientes.length} conductores):`);
    for (const [que, n] of [...cuenta].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  sin ${que}`.replace('sin licencia vencida', 'con la licencia vencida'));

    const rutaPendientes = opcion('pendientes');
    if (rutaPendientes) {
      writeFileSync(
        rutaPendientes,
        csv([['Código', 'Nombre', 'Qué falta'], ...i.pendientes.map((p) => [p.codigo, p.nombre, p.falta.join(', ')])]),
        { encoding: 'utf8', mode: 0o600 },
      );
      console.log(`\nLa lista completa quedó en ${rutaPendientes}.`);
    }

    if (!aplicar) {
      console.log('\nSIMULACIÓN: no se guardó nada. Para cargarlo de verdad, repite el comando con --aplicar.');
      return;
    }
    console.log('\nListo: quedó guardado y en la bitácora de auditoría.');
    const rutaPines = opcion('pines');
    if (i.conductores.conPinNuevo.length && rutaPines) {
      writeFileSync(
        rutaPines,
        csv([['Código', 'Nombre', 'PIN'], ...i.conductores.conPinNuevo.map((c) => [c.codigo, c.nombre, c.pin ?? ''])]),
        { encoding: 'utf8', mode: 0o600 },
      );
      console.log(`Los PIN nuevos quedaron en ${rutaPines}. Entrégalos y borra el archivo.`);
    } else if (i.conductores.conPinNuevo.length) {
      console.log('Hay conductores con PIN nuevo y no se pidió --pines: cámbiales el PIN desde el panel para entregárselo.');
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Falló la carga:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
