import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  diasDelRango,
  fechasDelRango,
  type CarreraDeOperadora,
  type DestinoDeCarreras,
  type FilaOperadora,
  type FiltrosDeOperadoras,
  type TableroOperadoras,
} from '@tax/shared';
import { DB, type Database } from '../../db/db.module';
import { ZONA_HORARIA, limitesDelPeriodo } from './exports.data';

/**
 * Se quedó sin taxi, igual que en Reportes: sigue sin asignar, o el sistema la
 * cerró porque nadie la tomó. Para la empresa es demanda sin atender, no una
 * cancelación.
 */
const SIN_TAXI = sql`(r.status = 'UNASSIGNED' or (r.status = 'CANCELLED' and r.cancelled_by = 'system' and r.cancel_code in ('sin_conductor', 'caducada')))`;

const VACIO: DestinoDeCarreras = { creadas: 0, terminadas: 0, canceladas: 0, sinTaxi: 0, abiertas: 0 };

interface FilaDestino extends Record<string, unknown> {
  id: string | null;
  creadas: number;
  terminadas: number;
  canceladas: number;
  sin_taxi: number;
  abiertas: number;
  asignacion_p50: number | null;
}

const destinoDe = (f?: FilaDestino): DestinoDeCarreras =>
  f
    ? { creadas: f.creadas, terminadas: f.terminadas, canceladas: f.canceladas, sinTaxi: f.sin_taxi, abiertas: f.abiertas }
    : { ...VACIO };

/**
 * Operadoras (28/11/2026): qué hizo cada persona de la oficina.
 *
 * Dos fuentes, y las dos ya existían:
 *  - las carreras que registró (`rides.created_by`), contadas por el día en
 *    que se crearon, como en Reportes;
 *  - lo que hizo sobre cualquier carrera —asignar a mano, relanzar, cancelar—,
 *    que sale del historial de estados y de la bitácora, y se cuenta por el
 *    día en que lo hizo.
 *
 * Las horas y los días son los de Colombia.
 */
@Injectable()
export class OperadorasService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async tablero(f: FiltrosDeOperadoras): Promise<TableroOperadoras> {
    const limites = await limitesDelPeriodo(this.db, { desde: f.desde, hasta: f.hasta });
    const desde = limites.desde.toISOString();
    const hasta = limites.hasta.toISOString();
    const fechas = fechasDelRango(f.desde, f.hasta);

    const sinPruebas: SQL = f.sinPruebas
      ? sql`and not c.es_prueba and not coalesce(d.es_prueba, false)`
      : sql``;

    const [destinos, reparto, acciones, manuales, usuarios] = await Promise.all([
      // Una fila por operadora, y una con `id` nulo: lo que entró por WhatsApp.
      this.db.execute<FilaDestino>(sql`
        select r.created_by as id,
               count(*)::int as creadas,
               count(*) filter (where r.status = 'COMPLETED')::int as terminadas,
               count(*) filter (where r.status = 'CANCELLED' and not ${SIN_TAXI})::int as canceladas,
               count(*) filter (where ${SIN_TAXI})::int as sin_taxi,
               count(*) filter (where r.status not in ('COMPLETED', 'CANCELLED', 'UNASSIGNED'))::int as abiertas,
               round(percentile_cont(0.5) within group (
                 order by extract(epoch from r.assigned_at - r.created_at)
               ) filter (where r.assigned_at is not null))::int as asignacion_p50
          from rides r
          join customers c on c.id = r.customer_id
          left join drivers d on d.id = r.driver_id
         where r.created_at >= ${desde}::timestamptz and r.created_at < ${hasta}::timestamptz
           ${sinPruebas}
         group by r.created_by
      `),
      this.db.execute<{ id: string; dia: string; hora: number; carreras: number }>(sql`
        select r.created_by as id,
               to_char(r.created_at at time zone ${ZONA_HORARIA}, 'YYYY-MM-DD') as dia,
               extract(hour from r.created_at at time zone ${ZONA_HORARIA})::int as hora,
               count(*)::int as carreras
          from rides r
          join customers c on c.id = r.customer_id
          left join drivers d on d.id = r.driver_id
         where r.created_by is not null
           and r.created_at >= ${desde}::timestamptz and r.created_at < ${hasta}::timestamptz
           ${sinPruebas}
         group by 1, 2, 3
      `),
      // Solo usuarios del panel: una integración que relanza no es una operadora.
      this.db.execute<{ id: string; relanzamientos: number; cancelaciones: number; ultima: Date }>(sql`
        select h.actor_id as id,
               count(*) filter (where h.to_status = 'NOTIFIED' and h.note like 'Relanzar%')::int as relanzamientos,
               count(*) filter (where h.to_status = 'CANCELLED')::int as cancelaciones,
               max(h.at) as ultima
          from ride_status_history h
          join users u on u.id = h.actor_id
          join rides r on r.id = h.ride_id
          join customers c on c.id = r.customer_id
          left join drivers d on d.id = r.driver_id
         where h.actor = 'operator'
           and h.at >= ${desde}::timestamptz and h.at < ${hasta}::timestamptz
           ${sinPruebas}
         group by h.actor_id
      `),
      /*
       * Las asignaciones a mano salen de la bitácora: en el historial de
       * estados ese paso queda a nombre del conductor que recibe la carrera,
       * y solo la bitácora dice qué persona de la oficina se la puso.
       */
      this.db.execute<{ id: string; manuales: number; ultima: Date }>(sql`
        select a.actor_id as id, count(*)::int as manuales, max(a.at) as ultima
          from audit_log a
          join users u on u.id = a.actor_id
          join rides r on r.code = a.entity_id
          join customers c on c.id = r.customer_id
          left join drivers d on d.id = r.driver_id
         where a.entity = 'rides' and a.action = 'Aceptó la carrera'
           and a.at >= ${desde}::timestamptz and a.at < ${hasta}::timestamptz
           ${sinPruebas}
         group by a.actor_id
      `),
      this.db.execute<{ id: string; nombre: string; usuario: string; rol: string; activo: boolean }>(sql`
        select u.id, u.name as nombre, u.email as usuario, coalesce(ro.name, u.role) as rol, u.active as activo
          from users u
          left join roles ro on ro.key = u.role
         order by u.name
      `),
    ]);

    const destinoPor = new Map(destinos.rows.map((d) => [d.id, d]));
    const accionPor = new Map(acciones.rows.map((a) => [a.id, a]));
    const manualPor = new Map(manuales.rows.map((m) => [m.id, m]));

    const operadoras: FilaOperadora[] = usuarios.rows
      .map((u) => {
        const destino = destinoPor.get(u.id);
        const accion = accionPor.get(u.id);
        const manual = manualPor.get(u.id);
        const ultima = Math.max(accion ? new Date(accion.ultima).getTime() : 0, manual ? new Date(manual.ultima).getTime() : 0);
        const suyas = reparto.rows.filter((r) => r.id === u.id);
        const porHora = Array.from({ length: 24 }, () => 0);
        const porDia = fechas.map(() => 0);
        for (const r of suyas) {
          porHora[r.hora] = (porHora[r.hora] ?? 0) + r.carreras;
          const i = fechas.indexOf(r.dia);
          if (i >= 0) porDia[i] = (porDia[i] ?? 0) + r.carreras;
        }
        return {
          id: u.id,
          nombre: u.nombre,
          usuario: u.usuario,
          rol: u.rol,
          activo: u.activo,
          ...destinoDe(destino),
          asignacionesManuales: manual?.manuales ?? 0,
          relanzamientos: accion?.relanzamientos ?? 0,
          cancelacionesHechas: accion?.cancelaciones ?? 0,
          asignacionP50: destino?.asignacion_p50 ?? null,
          diasConCarreras: porDia.filter((n) => n > 0).length,
          ultimaActividad: ultima > 0 ? new Date(ultima).toISOString() : null,
          porHora,
          porDia,
        };
      })
      // Quien está inactivo y no hizo nada en el periodo no aporta nada a la tabla.
      .filter((o) => o.activo || o.creadas > 0 || o.ultimaActividad !== null)
      .sort((a, b) => b.creadas - a.creadas || a.nombre.localeCompare(b.nombre, 'es'));

    const suma = (clave: keyof FilaOperadora) => operadoras.reduce((s, o) => s + (o[clave] as number), 0);
    const porHora = Array.from({ length: 24 }, (_, h) => operadoras.reduce((s, o) => s + (o.porHora[h] ?? 0), 0));
    const maximo = Math.max(...porHora);

    return {
      periodo: { desde: f.desde, hasta: f.hasta, dias: diasDelRango(f.desde, f.hasta) },
      fechas,
      oficina: {
        creadas: suma('creadas'),
        terminadas: suma('terminadas'),
        canceladas: suma('canceladas'),
        sinTaxi: suma('sinTaxi'),
        abiertas: suma('abiertas'),
        asignacionesManuales: suma('asignacionesManuales'),
        relanzamientos: suma('relanzamientos'),
        cancelacionesHechas: suma('cancelacionesHechas'),
        porHora,
        horaPico: maximo > 0 ? { hora: porHora.indexOf(maximo), carreras: maximo } : null,
      },
      asistente: destinoDe(destinoPor.get(null)),
      operadoras,
    };
  }

  /** Las últimas carreras que registró una operadora en el periodo. */
  async carreras(operadora: string, f: FiltrosDeOperadoras): Promise<CarreraDeOperadora[]> {
    const limites = await limitesDelPeriodo(this.db, { desde: f.desde, hasta: f.hasta });
    const { rows } = await this.db.execute<{
      id: string;
      codigo: string;
      creada: Date;
      recogida: string;
      estado: string;
      conductor: string | null;
      placa: string | null;
    }>(sql`
      select r.id, r.code as codigo, r.created_at as creada, r.pickup_text as recogida, r.status::text as estado,
             case when d.id is null then null else d.code || ' · ' || d.name end as conductor,
             v.plate as placa
        from rides r
        join customers c on c.id = r.customer_id
        left join drivers d on d.id = r.driver_id
        left join vehicles v on v.id = r.vehicle_id
       where r.created_by = ${operadora}::uuid
         and r.created_at >= ${limites.desde.toISOString()}::timestamptz
         and r.created_at < ${limites.hasta.toISOString()}::timestamptz
         ${f.sinPruebas ? sql`and not c.es_prueba and not coalesce(d.es_prueba, false)` : sql``}
       order by r.created_at desc
       limit 30
    `);
    return rows.map((r) => ({ ...r, creada: new Date(r.creada).toISOString() }));
  }
}
