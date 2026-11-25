import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { CENTRO } from './coordenadas';

/**
 * Prueba de carga: una flota entera en turno contra la API en marcha.
 *
 * Simula lo que hace cada teléfono de conductor: entra, abre turno, mantiene
 * el socket abierto y manda su posición cada pocos segundos. Encima, la
 * oficina crea carreras a ritmo de hora pico y los conductores contestan las
 * ofertas como personas (unos segundos después, y no todos).
 *
 * Mide lo que importa para saber si un servidor aguanta a una empresa:
 * cuánto tarda cada posición, cuánto tarda una oferta en llegar al primer
 * taxi, cuántas carreras se quedan sin asignar y cuánta memoria usa la API.
 *
 *   pnpm --filter @tax/api exec tsx src/test/carga.ts <clave-de-api> \
 *     [--conductores 300] [--segundos 120] [--carreras-por-minuto 20] [--posicion-cada 2]
 *
 * SOLO contra una API de desarrollo:
 *  - crea conductores de prueba (códigos 9001 en adelante, marcados
 *    `es_prueba`) y los deja inactivos al terminar;
 *  - borra los contadores del límite de peticiones mientras corre, porque
 *    aquí toda la flota sale de una sola IP y en la calle cada teléfono
 *    tiene la suya.
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
// La clave puede ir como primer argumento o en TAX_API_KEY; lo que empieza
// por «--» es una opción, no la clave.
const API_KEY = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.TAX_API_KEY;

function opcion(nombre: string, porDefecto: number): number {
  const i = process.argv.indexOf(`--${nombre}`);
  const valor = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
}

const CONDUCTORES = opcion('conductores', 300);
const SEGUNDOS = opcion('segundos', 120);
const CARRERAS_POR_MINUTO = opcion('carreras-por-minuto', 20);
const POSICION_CADA_S = opcion('posicion-cada', 2);
const CALENTAMIENTO_S = 20;
/** De cada 10 ofertas, cuántas se intentan aceptar. */
const GANAS_DE_ACEPTAR = 0.6;

/* ------------------------------------------------------------- medidas */

class Medida {
  private readonly ms: number[] = [];
  private readonly estados = new Map<number, number>();

  anotar(milisegundos: number, estado: number): void {
    this.ms.push(milisegundos);
    this.estados.set(estado, (this.estados.get(estado) ?? 0) + 1);
  }

  get total(): number {
    return this.ms.length;
  }

  /** Respuestas que no son 2xx; el 0 es «no hubo respuesta». */
  get fallos(): number {
    let n = 0;
    for (const [estado, veces] of this.estados) if (estado < 200 || estado >= 300) n += veces;
    return n;
  }

  percentil(p: number): number {
    if (this.ms.length === 0) return 0;
    const orden = [...this.ms].sort((a, b) => a - b);
    return Math.round(orden[Math.min(orden.length - 1, Math.floor((p / 100) * orden.length))]!);
  }

  resumen(): string {
    const estados = [...this.estados].sort((a, b) => a[0] - b[0]).map(([e, n]) => `${e}×${n}`).join(' ');
    return `${String(this.total).padStart(6)} peticiones · p50 ${this.percentil(50)} ms · p95 ${this.percentil(95)} ms · p99 ${this.percentil(99)} ms · máx ${this.percentil(100)} ms · ${estados}`;
  }
}

const medidas = {
  acceso: new Medida(),
  abrirTurno: new Medida(),
  posicionSola: new Medida(),
  posicionConCarreras: new Medida(),
  crearCarrera: new Medida(),
  aceptar: new Medida(),
};

async function pedir(
  medida: Medida | null,
  ruta: string,
  opciones: { cuerpo?: unknown; token?: string; clave?: boolean; idempotencia?: string; metodo?: string } = {},
): Promise<{ estado: number; cuerpo: Record<string, unknown> }> {
  const cabeceras: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
  if (opciones.token) cabeceras.authorization = `Bearer ${opciones.token}`;
  if (opciones.clave) cabeceras['x-api-key'] = API_KEY!;
  if (opciones.idempotencia) cabeceras['idempotency-key'] = opciones.idempotencia;

  const inicio = performance.now();
  let estado = 0;
  let cuerpo: Record<string, unknown> = {};
  try {
    const respuesta = await fetch(`${BASE}${ruta}`, {
      method: opciones.metodo ?? (opciones.cuerpo !== undefined ? 'POST' : 'GET'),
      headers: cabeceras,
      body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    estado = respuesta.status;
    const texto = await respuesta.text();
    try {
      cuerpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    } catch {
      cuerpo = { crudo: texto.slice(0, 200) };
    }
  } catch {
    estado = 0;
  }
  medida?.anotar(performance.now() - inicio, estado);
  return { estado, cuerpo };
}

/** `n` a la vez, no todos de golpe: 300 accesos simultáneos no es una flota, es un ataque. */
async function porTandas<T>(elementos: T[], aLaVez: number, tarea: (elemento: T) => Promise<void>): Promise<void> {
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(aLaVez, elementos.length) }, async () => {
      while (siguiente < elementos.length) await tarea(elementos[siguiente++]!);
    }),
  );
}

const esperar = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

/** Un punto al azar a menos de `radioKm` del centro, repartido parejo. */
function puntoCerca(radioKm: number): { lat: number; lng: number } {
  const distancia = radioKm * Math.sqrt(Math.random());
  const angulo = Math.random() * 2 * Math.PI;
  return {
    lat: CENTRO.lat + (distancia * Math.cos(angulo)) / 111.32,
    lng: CENTRO.lng + (distancia * Math.sin(angulo)) / (111.32 * Math.cos((CENTRO.lat * Math.PI) / 180)),
  };
}

/* ---------------------------------------------------------- conductores */

interface Conductor {
  codigo: string;
  placa: string;
  token?: string;
  socket?: Socket;
  punto: { lat: number; lng: number };
  carrera?: string;
  reloj?: NodeJS.Timeout;
}

const PIN = '4821';

async function prepararFlota(db: Pool, flota: Conductor[]): Promise<void> {
  const base = await db.query<{ pin_hash: string }>(`select pin_hash from drivers where code = '101'`);
  const pinHash = base.rows[0]?.pin_hash;
  if (!pinHash) throw new Error('No existe el conductor 101: ¿falta sembrar la base (pnpm db:seed)?');

  for (const c of flota) {
    await db.query(
      `insert into vehicles (id, plate, type, capacity) values ($1, $2, 'sedan', 4) on conflict (plate) do nothing`,
      [randomUUID(), c.placa],
    );
    await db.query(
      `insert into drivers (id, code, name, phone, pin_hash, es_prueba)
       values ($1, $2, $3, $4, $5, true)
       on conflict (code) do update
         set active = true, failed_attempts = 0, locked_until = null, suspendido_hasta = null`,
      [randomUUID(), c.codigo, `Carga ${c.codigo}`, `+57319${c.codigo}000`, pinHash],
    );
    await db.query(
      `insert into vehicle_drivers (id, vehicle_id, driver_id, role, origen)
       select $1, v.id, d.id, 'conductor', 'panel' from vehicles v, drivers d
       where v.plate = $2 and d.code = $3
       on conflict do nothing`,
      [randomUUID(), c.placa, c.codigo],
    );
  }
}

/* ---------------------------------------------------------------- prueba */

interface Carrera {
  id: string;
  creadaEn: number;
  primeraOferta?: number;
  ofertas: number;
  asignadaEn?: number;
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('Falta la clave de API. Pásala como argumento o en TAX_API_KEY.');
    process.exit(1);
  }
  if (!/localhost|127\.0\.0\.1/.test(BASE) && process.env.CARGA_FUERA_DE_LOCAL !== 'si') {
    console.error(`Esta prueba es para una API de desarrollo, no para ${BASE}.`);
    process.exit(1);
  }

  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:16379');

  // Toda la flota sale de esta máquina: sin esto, el límite por IP (pensado
  // para un teléfono) corta la prueba en el segundo acceso número 21.
  const sinLimites = setInterval(() => {
    void (async () => {
      const claves = await redis.keys('tax:rl:*');
      if (claves.length > 0) await redis.del(...claves);
    })().catch(() => undefined);
  }, 150);

  const flota: Conductor[] = Array.from({ length: CONDUCTORES }, (_, i) => ({
    codigo: String(9001 + i),
    placa: `CRG${String(i + 1).padStart(3, '0')}`,
    // Dentro de la zona «Centro» (2 km): fuera, el despacho no los cuenta.
    punto: puntoCerca(1.8),
  }));

  const carreras = new Map<string, Carrera>();
  let fase: 'sola' | 'carreras' = 'sola';
  let corriendo = true;
  const memoria: number[] = [];
  let perdidasPorOtro = 0;
  let aceptadas = 0;

  console.log(`\nPrueba de carga contra ${BASE}`);
  console.log(`${CONDUCTORES} conductores · posición cada ${POSICION_CADA_S} s · ${CARRERAS_POR_MINUTO} carreras por minuto durante ${SEGUNDOS} s\n`);

  try {
    console.log('0. Preparando la flota de prueba…');
    await prepararFlota(db, flota);

    console.log('1. Los conductores entran y abren turno…');
    const inicioAccesos = performance.now();
    await porTandas(flota, 6, async (c) => {
      let acceso = await pedir(medidas.acceso, '/v1/auth/driver', {
        cuerpo: { code: c.codigo, pin: PIN, device: 'prueba de carga', install: `carga-${c.codigo}` },
      });
      // El límite de accesos es de 20 por minuto y por IP: bien para un
      // teléfono, pero aquí entran todos desde la misma máquina. Se espera a
      // que el barrido de arriba borre el contador y se repite.
      for (let intento = 0; acceso.estado === 429 && intento < 20; intento++) {
        await esperar(200);
        acceso = await pedir(null, '/v1/auth/driver', {
          cuerpo: { code: c.codigo, pin: PIN, device: 'prueba de carga', install: `carga-${c.codigo}` },
        });
      }
      c.token = acceso.cuerpo.token as string | undefined;
      if (!c.token) return;
      // Por si quedó un turno abierto de una pasada anterior.
      await pedir(null, '/v1/driver/shift/close', { token: c.token, cuerpo: {} });
      await pedir(medidas.abrirTurno, '/v1/driver/shift/open', { token: c.token, cuerpo: { plate: c.placa } });
    });
    const dentro = flota.filter((c) => c.token);
    console.log(`   ${dentro.length} de ${flota.length} en turno, en ${Math.round((performance.now() - inicioAccesos) / 1000)} s`);
    if (dentro.length < flota.length * 0.9) throw new Error('Entró menos del 90 % de la flota: no tiene sentido seguir.');

    console.log('2. Cada teléfono abre su socket…');
    let conectados = 0;
    await porTandas(dentro, 20, async (c) => {
      const socket = io(`${BASE}/rt`, { auth: { token: c.token }, transports: ['websocket'], reconnection: true });
      c.socket = socket;
      socket.on('ride:offer', (oferta: { rideId?: string }) => {
        const rideId = oferta?.rideId;
        if (!rideId || !corriendo) return;
        const carrera = carreras.get(rideId);
        if (carrera) {
          carrera.ofertas += 1;
          carrera.primeraOferta ??= performance.now();
        }
        if (c.carrera || Math.random() > GANAS_DE_ACEPTAR) return;
        // Un conductor tarda en mirar el teléfono y decidir.
        setTimeout(() => {
          if (!corriendo || c.carrera) return;
          void pedir(medidas.aceptar, `/v1/driver/rides/${rideId}/accept`, {
            token: c.token,
            cuerpo: {},
            idempotencia: randomUUID(),
          }).then((r) => {
            if (r.estado >= 200 && r.estado < 300) {
              aceptadas += 1;
              c.carrera = rideId;
              const ganada = carreras.get(rideId);
              if (ganada) ganada.asignadaEn ??= performance.now();
            } else if (r.estado === 409) {
              perdidasPorOtro += 1;
            }
          });
        }, 1_000 + Math.random() * 3_000);
      });
      await new Promise<void>((listo) => {
        const tope = setTimeout(listo, 8_000);
        socket.once('connect', () => {
          conectados += 1;
          clearTimeout(tope);
          listo();
        });
      });
    });
    console.log(`   ${conectados} sockets conectados`);

    console.log(`3. Solo posiciones, ${CALENTAMIENTO_S} s (la flota esperando)…`);
    for (const c of dentro) {
      const enviar = () => {
        if (!corriendo) return;
        // Se mueve unos metros, como un carro que rueda despacio.
        c.punto = { lat: c.punto.lat + (Math.random() - 0.5) * 0.0002, lng: c.punto.lng + (Math.random() - 0.5) * 0.0002 };
        void pedir(fase === 'sola' ? medidas.posicionSola : medidas.posicionConCarreras, '/v1/driver/position', {
          token: c.token,
          cuerpo: { point: c.punto, accuracyMeters: 8, ...(c.carrera ? { rideId: c.carrera } : {}) },
        });
      };
      // Cada teléfono empieza en un momento distinto del ciclo.
      setTimeout(() => {
        enviar();
        c.reloj = setInterval(enviar, POSICION_CADA_S * 1000);
      }, Math.random() * POSICION_CADA_S * 1000);
    }
    const vigia = setInterval(() => {
      void pedir(null, '/status').then((r) => {
        const rss = (r.cuerpo.process as { rssMb?: number } | undefined)?.rssMb;
        if (rss) memoria.push(rss);
      });
    }, 5_000);
    await esperar(CALENTAMIENTO_S * 1000);

    console.log(`4. Hora pico: ${CARRERAS_POR_MINUTO} carreras por minuto durante ${SEGUNDOS} s…`);
    fase = 'carreras';
    const cadaMs = 60_000 / CARRERAS_POR_MINUTO;
    const finPico = Date.now() + SEGUNDOS * 1000;
    let n = 0;
    while (Date.now() < finPico) {
      n += 1;
      const creadaEn = performance.now();
      void pedir(medidas.crearCarrera, '/v1/rides', {
        clave: true,
        idempotencia: `carga-${Date.now()}-${n}`,
        cuerpo: {
          customerPhone: `+5732${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
          pickup: { text: `Prueba de carga ${n}`, point: puntoCerca(1.5) },
          vehicleType: 'sedan',
          passengers: 1,
          pagoElectronico: false,
        },
      }).then((r) => {
        const id = r.cuerpo.id as string | undefined;
        if (id) carreras.set(id, { id, creadaEn, ofertas: 0, ...carreras.get(id) });
      });
      await esperar(cadaMs);
    }

    console.log('5. Se deja de pedir; las últimas terminan de asignarse (30 s)…');
    await esperar(30_000);
    clearInterval(vigia);
  } finally {
    corriendo = false;
    for (const c of flota) if (c.reloj) clearInterval(c.reloj);

    console.log('6. Limpieza: cancelar carreras, cerrar turnos y apartar la flota de prueba…');
    await porTandas([...carreras.keys()], 4, async (id) => {
      await pedir(null, `/v1/rides/${id}/cancel`, { clave: true, cuerpo: { reason: 'Fin de la prueba de carga' } });
    });
    await porTandas(flota.filter((c) => c.token), 10, async (c) => {
      c.socket?.disconnect();
      await pedir(null, '/v1/driver/shift/close', { token: c.token, cuerpo: {} });
    });
    await db.query(`update drivers set active = false where es_prueba and code ~ '^9[0-9]{3}$'`).catch(() => undefined);
    clearInterval(sinLimites);
  }

  /* --------------------------------------------------------------- informe */

  const lista = [...carreras.values()];
  const conOferta = lista.filter((c) => c.primeraOferta !== undefined);
  const asignadas = lista.filter((c) => c.asignadaEn !== undefined);
  const hastaOferta = new Medida();
  for (const c of conOferta) hastaOferta.anotar(c.primeraOferta! - c.creadaEn, 200);
  const hastaAsignada = new Medida();
  for (const c of asignadas) hastaAsignada.anotar(c.asignadaEn! - c.creadaEn, 200);

  const finales = await db.query<{ status: string; n: number }>(
    `select status, count(*)::int n from rides where id = any($1) group by status order by status`,
    [lista.map((c) => c.id)],
  );

  console.log('\n────────────────────────── Resultado ──────────────────────────');
  console.log(`Acceso (PIN)            ${medidas.acceso.resumen()}`);
  console.log(`Abrir turno             ${medidas.abrirTurno.resumen()}`);
  console.log(`Posición, flota quieta  ${medidas.posicionSola.resumen()}`);
  console.log(`Posición, en hora pico  ${medidas.posicionConCarreras.resumen()}`);
  console.log(`Crear carrera           ${medidas.crearCarrera.resumen()}`);
  console.log(`Aceptar oferta          ${medidas.aceptar.resumen()}`);
  console.log('');
  console.log(`Carreras creadas: ${lista.length} · con oferta entregada: ${conOferta.length} · aceptadas: ${asignadas.length}`);
  console.log(`De crear a la primera oferta en un teléfono: p50 ${hastaOferta.percentil(50)} ms · p95 ${hastaOferta.percentil(95)} ms · máx ${hastaOferta.percentil(100)} ms`);
  console.log(`De crear a asignada (incluye 1 a 4 s del conductor): p50 ${hastaAsignada.percentil(50)} ms · p95 ${hastaAsignada.percentil(95)} ms`);
  console.log(`Aceptaciones ganadas: ${aceptadas} · perdidas porque otro la tomó antes: ${perdidasPorOtro}`);
  console.log(`Estado final en la base (tras cancelar): ${finales.rows.map((r) => `${r.status} ${r.n}`).join(' · ') || '—'}`);
  if (memoria.length > 0) console.log(`Memoria de la API: de ${Math.min(...memoria)} a ${Math.max(...memoria)} MB`);

  const posiciones = medidas.posicionSola.total + medidas.posicionConCarreras.total;
  const fallosPosicion = medidas.posicionSola.fallos + medidas.posicionConCarreras.fallos;
  const porSegundo = Math.round(posiciones / (CALENTAMIENTO_S + SEGUNDOS + 30));
  console.log(`Posiciones: ${posiciones} (${porSegundo} por segundo) · fallidas: ${fallosPosicion}`);

  const problemas: string[] = [];
  if (posiciones > 0 && fallosPosicion / posiciones > 0.01) problemas.push('más del 1 % de las posiciones falló');
  if (medidas.posicionConCarreras.percentil(95) > 500) problemas.push('el p95 de posición en hora pico pasa de 500 ms');
  if (medidas.crearCarrera.fallos > 0) problemas.push(`${medidas.crearCarrera.fallos} carreras no se pudieron crear`);
  if (hastaOferta.percentil(95) > 3_000) problemas.push('el p95 hasta la primera oferta pasa de 3 s');
  if (lista.length > 0 && conOferta.length < lista.length * 0.95) problemas.push('más del 5 % de las carreras no llegó a ningún teléfono');

  console.log(problemas.length === 0 ? '\nAguanta: dentro de los límites.\n' : `\nNO aguanta bien: ${problemas.join('; ')}.\n`);
  if (problemas.length > 0) process.exitCode = 1;

  await db.end();
  redis.disconnect();
}

main().catch((error: unknown) => {
  console.error('\nLa prueba se cortó:', error instanceof Error ? error.message : error);
  process.exit(1);
});
