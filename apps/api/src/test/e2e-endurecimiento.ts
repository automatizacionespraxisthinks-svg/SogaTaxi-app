import 'dotenv/config';
import { Pool } from 'pg';
import { CENTRO } from './coordenadas';

/**
 * Los arreglos del despacho del 25/11/2026, de extremo a extremo:
 *
 *  1. Aceptar dos veces la misma carrera (reintento sin señal) no responde
 *     «otro aceptó primero».
 *  2. Pausar retira la oferta pendiente, y en pausa no se acepta.
 *  3. Dos rechazos a la vez, que juntos agotan la oleada, la escalan una sola
 *     vez y ninguno de los dos conductores recibe un error.
 *  4. Una asignación manual que falla no deja la carrera «Notificada» sin
 *     temporizador: queda como estaba.
 *
 * Necesita la API en marcha, la base local sembrada y los conductores 101 a
 * 105 del seed.
 *
 *   pnpm --filter @tax/api exec tsx src/test/e2e-endurecimiento.ts <clave-de-api>
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const API_KEY = process.argv[2] ?? process.env.TAX_API_KEY;
const PIN = '4821';

const UNO = { code: '101', plate: 'UBP472' };
const DOS = { code: '102', plate: 'TQR118' };
const RESTO = [
  { code: '103', plate: 'SVM903' },
  { code: '104', plate: 'UZK240' },
  { code: '105', plate: 'TJA556' },
];

interface Json {
  [key: string]: unknown;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string; apiKey?: boolean } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.apiKey && API_KEY) headers['x-api-key'] = API_KEY;
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

function assert(condition: boolean, message: string, context?: unknown): void {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    if (context !== undefined) console.error('    ', JSON.stringify(context));
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('Falta la clave de API. Pásala como argumento o en TAX_API_KEY.');
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const tokens = new Map<string, string>();
  const carreras: string[] = [];

  const entrar = async (quien: { code: string; plate: string }) => {
    const login = await call('/v1/auth/driver', {
      body: { code: quien.code, plate: quien.plate, pin: PIN, device: 'prueba', install: `endurecer-${quien.code}` },
    });
    assert(login.status < 400, `conductor ${quien.code} entra`, login.body);
    tokens.set(quien.code, (login.body as { token: string }).token);
  };
  const token = (quien: { code: string }) => tokens.get(quien.code)!;
  const idDe = async (quien: { code: string }) =>
    (await pool.query<{ id: string }>('select id from drivers where code = $1', [quien.code])).rows[0]!.id;
  const estadoDe = async (rideId: string) =>
    (await pool.query<{ status: string }>('select status from rides where id = $1', [rideId])).rows[0]!.status;

  const enTurno = async (quien: { code: string; plate: string }) => {
    await call('/v1/driver/shift/close', { method: 'POST', token: token(quien) });
    const abierto = await call('/v1/driver/shift/open', { token: token(quien), body: { plate: quien.plate } });
    assert(abierto.status < 400, `${quien.code} abre turno`, abierto.body);
    await call('/v1/driver/position', { token: token(quien), body: { point: CENTRO } });
  };
  const fuera = async (quien: { code: string }) => {
    await call('/v1/driver/shift/close', { method: 'POST', token: token(quien) });
  };

  const crear = async (etiqueta: string) => {
    const creada = await call('/v1/rides', {
      apiKey: true,
      body: {
        customerPhone: `+5731${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        customerName: etiqueta,
        pickup: { text: 'Carrera 11 # 12-30', point: CENTRO },
        vehicleType: 'sedan',
        passengers: 1,
      },
    });
    assert(creada.status < 400, `carrera creada (${etiqueta})`, creada.body);
    const id = (creada.body as { id: string }).id;
    carreras.push(id);
    return id;
  };
  /** Espera a que la carrera tenga `n` ofertas pendientes. */
  const ofertas = async (rideId: string, n: number) => {
    for (let i = 0; i < 40; i++) {
      const filas = (
        await pool.query<{ driver_id: string }>(
          "select driver_id from ride_offers where ride_id = $1 and response = 'pending' and revoked_at is null",
          [rideId],
        )
      ).rows;
      if (filas.length >= n) return filas.map((f) => f.driver_id);
      await espera(200);
    }
    return [];
  };
  const cancelar = async (rideId: string) => {
    await call(`/v1/rides/${rideId}/cancel`, { apiKey: true, body: { reason: 'Limpieza de la prueba' } });
  };
  const cancelarActivas = async () => {
    const activas = await call('/v1/rides?status=ASSIGNED,DRIVER_ARRIVED,IN_PROGRESS,NOTIFIED,PENDING,UNASSIGNED', {
      apiKey: true,
    });
    for (const vieja of Array.isArray(activas.body) ? (activas.body as unknown as { id: string }[]) : []) {
      await cancelar(vieja.id);
    }
  };

  try {
    console.log('\n0. Limpieza');
    await cancelarActivas();
    for (const c of [UNO, DOS, ...RESTO]) {
      await entrar(c);
      await fuera(c);
    }

    /* ---------------------------------------------------------------- 1 */
    console.log('\n1. Aceptar dos veces la misma carrera');
    await enTurno(UNO);
    const a = await crear('Doble aceptar');
    assert((await ofertas(a, 1)).length === 1, 'la oleada se la ofrece al único en turno');
    const primera = await call(`/v1/driver/rides/${a}/accept`, { method: 'POST', token: token(UNO) });
    assert(primera.status < 400, 'la primera vez la acepta', primera.body);
    const segunda = await call(`/v1/driver/rides/${a}/accept`, { method: 'POST', token: token(UNO) });
    assert(segunda.status < 400, `la segunda responde igual, sin «otro aceptó» (HTTP ${segunda.status})`, segunda.body);
    assert((segunda.body as { id?: string }).id === a && (await estadoDe(a)) === 'ASSIGNED', 'y la carrera sigue siendo suya');
    const eventos = (
      await pool.query<{ n: number }>(
        "select count(*)::int as n from outbox_events where ride_id = $1 and type in ('ride.assigned', 'ride.reassigned')",
        [a],
      )
    ).rows[0]!.n;
    assert(eventos === 1, `n8n recibe un solo aviso de asignación (${eventos})`);
    await enTurno(DOS);
    const ajeno = await call(`/v1/driver/rides/${a}/accept`, { method: 'POST', token: token(DOS) });
    assert(ajeno.status === 409 && ajeno.body.code === 'RIDE_ALREADY_TAKEN', 'a otro conductor sí le dice que ya fue tomada', ajeno.body);
    await fuera(DOS);
    await cancelar(a);

    /* ---------------------------------------------------------------- 2 */
    console.log('\n2. Pausar retira la oferta pendiente');
    await enTurno(UNO);
    const b = await crear('Pausa con oferta');
    assert((await ofertas(b, 1)).length === 1, 'tiene la oferta en pantalla');
    const pausa = await call('/v1/driver/shift/pause', { method: 'POST', token: token(UNO) });
    assert(pausa.status < 400, 'se pausa', pausa.body);
    assert((await ofertas(b, 1)).length === 0, 'la oferta deja de estar pendiente');
    const enPausa = await call(`/v1/driver/rides/${b}/accept`, { method: 'POST', token: token(UNO) });
    assert(enPausa.status >= 400, `en pausa no puede aceptarla (HTTP ${enPausa.status}, ${String(enPausa.body.code)})`, enPausa.body);
    assert((await estadoDe(b)) !== 'ASSIGNED', 'y la carrera no quedó asignada');
    await call('/v1/driver/shift/resume', { method: 'POST', token: token(UNO) });
    await cancelar(b);

    /* ---------------------------------------------------------------- 3 */
    console.log('\n3. Dos rechazos a la vez agotan la oleada');
    await enTurno(UNO);
    await enTurno(DOS);
    const c = await crear('Doble rechazo');
    assert((await ofertas(c, 2)).length === 2, 'los dos tienen la oferta');
    const [r1, r2] = await Promise.all([
      call(`/v1/driver/rides/${c}/reject`, { method: 'POST', token: token(UNO) }),
      call(`/v1/driver/rides/${c}/reject`, { method: 'POST', token: token(DOS) }),
    ]);
    assert(r1.status < 400 && r2.status < 400, `ninguno recibe un error (HTTP ${r1.status} y ${r2.status})`, [r1.body, r2.body]);
    await espera(1500);
    const registro = (
      await pool.query<{ wave_log: { wave: number; intento: number }[] }>('select wave_log from rides where id = $1', [c])
    ).rows[0]!.wave_log;
    const claves = registro.map((e) => `${e.intento}-${e.wave}`);
    assert(claves.length > 1, `la carrera escaló (${claves.join(', ')})`);
    assert(new Set(claves).size === claves.length, 'y cada oleada salió una sola vez', claves);
    await cancelar(c);
    await fuera(DOS);

    /* ---------------------------------------------------------------- 4 */
    console.log('\n4. Una asignación manual que falla no cuelga la carrera');
    await enTurno(UNO);
    const d1 = await crear('Ocupa al conductor');
    assert((await ofertas(d1, 1)).length === 1, 'el conductor recibe la primera');
    const toma = await call(`/v1/driver/rides/${d1}/accept`, { method: 'POST', token: token(UNO) });
    assert(toma.status < 400, 'y la acepta: queda en carrera', toma.body);

    const d2 = await crear('Queda sin asignar');
    let estado = '';
    for (let i = 0; i < 40 && estado !== 'UNASSIGNED'; i++) {
      estado = await estadoDe(d2);
      if (estado !== 'UNASSIGNED') await espera(200);
    }
    assert(estado === 'UNASSIGNED', 'sin nadie libre, la segunda queda sin asignar', estado);

    // El conductor figura libre aunque lleva una carrera: es lo que pasa si
    // toma otra oferta entre que la oficina lo elige y la asignación se
    // guarda. La base lo impide con el índice de una carrera activa.
    const idUno = await idDe(UNO);
    await pool.query("update drivers set status = 'AVAILABLE' where id = $1", [idUno]);
    const manual = await call(`/v1/rides/${d2}/assign`, { apiKey: true, body: { driverId: idUno } });
    const despues = await estadoDe(d2);
    await pool.query("update drivers set status = 'ON_RIDE' where id = $1", [idUno]);
    assert(manual.status === 409 && manual.body.code === 'DRIVER_BUSY', `la asignación se rechaza (HTTP ${manual.status}, ${String(manual.body.code)})`, manual.body);
    assert(despues === 'UNASSIGNED', `y la carrera sigue sin asignar, no «Notificada» (${despues})`);
    const colgadas = (
      await pool.query<{ n: number }>(
        "select count(*)::int as n from ride_offers where ride_id = $1 and driver_id = $2 and response = 'pending'",
        [d2, idUno],
      )
    ).rows[0]!.n;
    assert(colgadas === 0, 'sin oferta a medio crear');

    console.log('\nTodo correcto.\n');
  } finally {
    for (const id of carreras) await cancelar(id);
    await pool.query("update drivers set status = 'AVAILABLE' where code = any($1) and status = 'ON_RIDE' and not exists (select 1 from rides r where r.driver_id = drivers.id and r.status in ('ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS'))", [
      [UNO.code, DOS.code],
    ]);
    for (const c of [UNO, DOS]) if (tokens.has(c.code)) await fuera(c);
    await pool.end();
  }
}

main().catch((error) => {
  console.error('\nLa prueba falló:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
