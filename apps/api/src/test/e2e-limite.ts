import 'dotenv/config';
import Redis from 'ioredis';

/**
 * El límite de peticiones se cuenta por conductor, no por IP (25/11/2026).
 *
 * Dos conductores entran desde la misma máquina —la misma IP, como dos
 * teléfonos detrás del mismo operador móvil—. Uno agota su tope; el otro
 * tiene que seguir trabajando como si nada. Antes compartían el cubo y el
 * segundo recibía 429 sin haber hecho nada.
 *
 *   pnpm --filter @tax/api exec tsx src/test/e2e-limite.ts
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const PIN = '4821';
const TOPE = 240;

function assert(condicion: boolean, mensaje: string, contexto?: unknown): void {
  if (!condicion) {
    console.error(`  ✗ ${mensaje}`);
    if (contexto !== undefined) console.error('    ', JSON.stringify(contexto));
    process.exitCode = 1;
    throw new Error(mensaje);
  }
  console.log(`  ✓ ${mensaje}`);
}

async function entrar(codigo: string): Promise<string> {
  const r = await fetch(`${BASE}/v1/auth/driver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: codigo, pin: PIN, device: 'prueba', install: `prueba-e2e-${codigo}` }),
  });
  const cuerpo = (await r.json()) as { token?: string };
  if (!cuerpo.token) throw new Error(`El conductor ${codigo} no pudo entrar (HTTP ${r.status})`);
  return cuerpo.token;
}

const estado = async (token?: string) =>
  (await fetch(`${BASE}/v1/driver/rides/me`, { headers: token ? { authorization: `Bearer ${token}` } : {} })).status;

async function main(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:16379');
  const limpiar = async () => {
    const claves = await redis.keys('tax:rl:*');
    if (claves.length > 0) await redis.del(...claves);
  };

  try {
    await limpiar();
    const uno = await entrar('101');
    const otro = await entrar('102');

    console.log(`\n1. El conductor 101 hace ${TOPE + 20} peticiones en un minuto`);
    const respuestas: number[] = [];
    for (let i = 0; i < TOPE + 20; i++) respuestas.push(await estado(uno));
    const buenas = respuestas.filter((s) => s === 200).length;
    const frenadas = respuestas.filter((s) => s === 429).length;
    assert(buenas === TOPE, `pasan las primeras ${TOPE}`, { buenas, frenadas });
    assert(frenadas === 20, 'y las 20 de más se frenan con 429', { buenas, frenadas });

    console.log('\n2. El 102, desde la misma IP, sigue trabajando');
    assert((await estado(otro)) === 200, 'su petición pasa: no comparte el tope del 101');

    console.log('\n3. El 101 sigue frenado, y su posición no se frena nunca');
    assert((await estado(uno)) === 429, 'el 101 sigue con 429 hasta que pase el minuto');
    const posicion = await fetch(`${BASE}/v1/driver/position`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${uno}` },
      body: JSON.stringify({ point: { lat: 5.7148, lng: -72.9279 } }),
    });
    assert(posicion.status !== 429, `la posición del 101 no choca con el límite (HTTP ${posicion.status})`);

    console.log('\n4. Sin token se sigue contando por IP');
    await limpiar();
    const anonimas: number[] = [];
    for (let i = 0; i < TOPE + 5; i++) anonimas.push(await estado());
    assert(
      anonimas.filter((s) => s === 401).length === TOPE && anonimas.filter((s) => s === 429).length === 5,
      `${TOPE} rechazadas por falta de token y las 5 de más frenadas`,
    );

    console.log('\nTodo correcto.\n');
  } finally {
    // Que la siguiente prueba no herede los contadores de esta.
    await limpiar();
    redis.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('\nLa prueba falló:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
