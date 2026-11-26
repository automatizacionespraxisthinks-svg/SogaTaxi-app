import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

/**
 * Prueba de extremo a extremo de zonas y lugares, contra la API en marcha.
 *
 * Crea una zona y un lugar como lo haría la oficina, comprueba lo que se
 * rechaza (zona montada, palabra clave repetida, lugar fuera de servicio) y
 * pide una carrera sin ubicación ni dirección, solo con la palabra clave: el
 * taxi tiene que salir hacia el punto del lugar. Al final borra lo suyo.
 *
 *   pnpm --filter @tax/api exec tsx src/test/e2e-catalogo.ts <clave-de-api>
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const API_KEY = process.argv[2] ?? process.env.TAX_API_KEY;
const SUFIJO = Date.now().toString(36);
const TOKEN = `token-e2e-catalogo-${SUFIJO}`;
const USUARIO = '01a20000-0000-7000-8000-0000000ca7a1';

let fallos = 0;
function assert(condicion: boolean, mensaje: string, contexto?: unknown): void {
  if (condicion) {
    console.log(`  ✓ ${mensaje}`);
    return;
  }
  fallos += 1;
  console.error(`  ✗ ${mensaje}`);
  if (contexto !== undefined) console.error('   ', JSON.stringify(contexto).slice(0, 400));
}

async function llamar(ruta: string, opciones: { method?: string; body?: unknown; panel?: boolean } = {}) {
  const cabeceras: Record<string, string> = { 'content-type': 'application/json' };
  if (opciones.panel) cabeceras.cookie = `tax_session=${TOKEN}`;
  else cabeceras['x-api-key'] = API_KEY!;
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: opciones.method ?? 'GET',
    headers: cabeceras,
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, body: (texto ? JSON.parse(texto) : {}) as Record<string, any> };
}

async function main() {
  if (!API_KEY) {
    console.error('Falta la clave de API. Pásala como argumento o en TAX_API_KEY.');
    process.exit(1);
  }
  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const hash = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
  await db.query(
    `insert into users (id, email, name, password_hash, role, totp_enabled)
     values ($1, 'e2e-catalogo@sogataxi.local', 'Prueba Catálogo', 'x', 'administrador', true)
     on conflict (id) do nothing`,
    [USUARIO],
  );
  await db.query(
    `insert into sessions (id, user_id, token_hash, expires_at) values (gen_random_uuid(), $1, $2, now() + interval '1 hour')`,
    [USUARIO, hash],
  );

  let zonaId: string | undefined;
  const lugares: string[] = [];
  const carreras: string[] = [];

  try {
    console.log('\n1. Zonas');
    const montada = await llamar('/v1/admin/zones', {
      method: 'POST',
      panel: true,
      body: { name: `Encima del centro ${SUFIJO}`, kind: 'urbano', center: { lat: 5.7148, lng: -72.919 }, radiusKm: 1 },
    });
    assert(montada.status === 409 && montada.body.code === 'ZONE_OVERLAP', `una zona encima del Centro se rechaza (${montada.status} ${montada.body.code})`, montada.body);
    assert(String(montada.body.detail ?? '').includes('Centro'), 'y dice sobre cuál se monta', montada.body.detail);

    const nueva = await llamar('/v1/admin/zones', {
      method: 'POST',
      panel: true,
      body: { name: `Vereda de prueba ${SUFIJO}`, kind: 'rural', center: { lat: 5.810, lng: -72.92 }, radiusKm: 1.5 },
    });
    assert(nueva.status === 201 && typeof nueva.body.id === 'string', `una zona libre se crea (${nueva.status})`, nueva.body);
    zonaId = nueva.body.id;

    const zonas = await llamar('/v1/admin/zones', { panel: true });
    const creada = (zonas.body as unknown as { id: string; kind: string; waves: { radiusKm: number }[]; polygon: { coordinates: number[][][] } }[]).find((z) => z.id === zonaId);
    assert(Boolean(creada), 'aparece en la lista de zonas al instante, sin reiniciar');
    assert(creada?.polygon.coordinates[0]?.length === 65, `como círculo de 64 lados (${creada?.polygon.coordinates[0]?.length} puntos)`);

    const repetida = await llamar('/v1/admin/zones', {
      method: 'POST',
      panel: true,
      body: { name: `Vereda de prueba ${SUFIJO}`, kind: 'rural', center: { lat: 5.95, lng: -73.3 }, radiusKm: 1 },
    });
    assert(repetida.status === 409 && repetida.body.code === 'NAME_TAKEN', `el mismo nombre otra vez se rechaza (${repetida.body.code})`);

    /*
     * Los ajustes del despacho: una sola regla para toda la ciudad
     * (26/11/2026). Antes cada zona tenía sus oleadas.
     */
    const antes = await llamar('/v1/admin/dispatch', { panel: true });
    assert(antes.status === 200 && Array.isArray(antes.body.rondas) && antes.body.rondas.length === 3, `los ajustes del despacho se leen (${antes.status})`, antes.body);
    const mal = await llamar('/v1/admin/dispatch', {
      method: 'PATCH',
      panel: true,
      body: {
        rondas: [
          { wave: 1, radiusKm: 2, candidates: 200, timeoutSeconds: 25 },
          { wave: 2, radiusKm: 1, candidates: 200, timeoutSeconds: 30 },
          { wave: 3, radiusKm: 3, candidates: 200, timeoutSeconds: 40 },
        ],
        lejanos: { candidatos: 3, hastaKm: 40, margenKm: 1 },
        posicionMaximaMin: 30,
      },
    });
    assert(mal.status === 400, `rondas que buscan más cerca que la anterior se rechazan (${mal.status})`);
    const bien = await llamar('/v1/admin/dispatch', {
      method: 'PATCH',
      panel: true,
      body: {
        rondas: [
          { wave: 1, radiusKm: 0.5, candidates: 200, timeoutSeconds: 20 },
          { wave: 2, radiusKm: 1.5, candidates: 200, timeoutSeconds: 30 },
          { wave: 3, radiusKm: 3, candidates: 200, timeoutSeconds: 40 },
        ],
        lejanos: { candidatos: 2, hastaKm: 25, margenKm: 2 },
        posicionMaximaMin: 45,
      },
    });
    assert(bien.status === 200 && bien.body.rondas?.[0]?.radiusKm === 0.5 && bien.body.lejanos?.candidatos === 2, `cambiar los ajustes guarda de verdad (${bien.status})`, bien.body);
    const leidos = await llamar('/v1/admin/dispatch', { panel: true });
    assert(leidos.body.rondas?.[0]?.timeoutSeconds === 20 && leidos.body.lejanos?.hastaKm === 25, 'y se leen de vuelta');
    const restaurados = await llamar('/v1/admin/dispatch', { method: 'PATCH', panel: true, body: antes.body });
    assert(restaurados.status === 200, 'se dejan como estaban');

    console.log('\n2. Lugares');
    const lugar = await llamar('/v1/admin/places', {
      method: 'POST',
      panel: true,
      body: {
        name: `Tienda Don Prueba ${SUFIJO}`,
        aliases: [`donde don prueba ${SUFIJO}`, `la tienda azul ${SUFIJO}`, `Donde Don Prueba ${SUFIJO}`],
        point: { lat: 5.7156, lng: -72.9273 },
      },
    });
    assert(lugar.status === 201 && typeof lugar.body.id === 'string', `un lugar en el Centro se crea (${lugar.status})`, lugar.body);
    if (lugar.body.id) lugares.push(lugar.body.id);

    const enLista = await llamar('/v1/admin/places', { panel: true });
    const fila = (enLista.body as unknown as { id: string; aliases: string[]; kind: string }[]).find((p) => p.id === lugar.body.id);
    assert(fila?.aliases.length === 2, `las palabras repetidas con otra mayúscula se juntan (${fila?.aliases.length})`, fila?.aliases);
    assert(fila?.kind === 'urbano', `y toma el tipo de su zona (${fila?.kind})`);

    const robada = await llamar('/v1/admin/places', {
      method: 'POST',
      panel: true,
      body: { name: `Otra tienda ${SUFIJO}`, aliases: [`DONDE DON PRUEBA ${SUFIJO}`], point: { lat: 5.716, lng: -72.926 } },
    });
    assert(robada.status === 409 && robada.body.code === 'KEYWORD_TAKEN', `una palabra clave de otro lugar se rechaza (${robada.body.code})`);

    const fuera = await llamar('/v1/admin/places', {
      method: 'POST',
      panel: true,
      body: { name: `Lejísimos ${SUFIJO}`, aliases: [], point: { lat: 6.2, lng: -73.5 } },
    });
    assert(fuera.status === 422 && fuera.body.code === 'OUT_OF_COVERAGE', `un lugar fuera de servicio se rechaza (${fuera.body.code})`);

    console.log('\n3. Una carrera pedida solo con la palabra clave');
    const telefono = `+5731${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const carrera = await llamar('/v1/rides', {
      method: 'POST',
      body: { customerPhone: telefono, pickup: { text: `Estoy donde Don Prueba ${SUFIJO}, la casa del portón café` } },
    });
    if (carrera.body.id) carreras.push(carrera.body.id);
    assert(carrera.status === 201, `se crea (${carrera.status})`, carrera.body);
    assert(carrera.body.pickupSource === 'catalogo', `ubicada por el catálogo (${carrera.body.pickupSource})`);
    assert(carrera.body.pickupLat === 5.7156 && carrera.body.pickupLng === -72.9273, 'en el punto del lugar');

    const { rows } = await db.query('select uses from places where id = $1', [lugar.body.id]);
    assert(rows[0]?.uses === 1, `y el lugar cuenta un uso (${rows[0]?.uses})`);

    const quitado = await llamar(`/v1/admin/places/${lugar.body.id}`, { method: 'PATCH', panel: true, body: { active: false } });
    assert(quitado.status === 200, `quitarlo del catálogo funciona (${quitado.status})`);
    const otraCarrera = await llamar('/v1/rides', {
      method: 'POST',
      body: { customerPhone: `+5731${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, pickup: { text: `donde don prueba ${SUFIJO}` } },
    });
    if (otraCarrera.body.id) carreras.push(otraCarrera.body.id);
    assert(otraCarrera.body.pickupSource !== 'catalogo', `y ya no lo reconoce (${otraCarrera.body.pickupSource})`);
  } finally {
    for (const id of carreras) {
      await llamar(`/v1/rides/${id}/cancel`, { method: 'POST', body: { reason: 'Fin de la prueba del catálogo' } });
    }
    if (lugares.length) await db.query('delete from places where id = any($1::uuid[])', [lugares]);
    if (zonaId) {
      await db.query('delete from zones where id = $1', [zonaId]);
      // La API tiene las zonas en memoria: guardar los ajustes del despacho
      // tal como están las vuelve a cargar, ya sin la de prueba.
      const ajustes = await llamar('/v1/admin/dispatch', { panel: true });
      if (ajustes.status === 200) {
        await llamar('/v1/admin/dispatch', { method: 'PATCH', panel: true, body: ajustes.body });
      }
    }
    await db.query('delete from sessions where user_id = $1', [USUARIO]);
    await db.query('delete from users where id = $1', [USUARIO]);
    await db.end();
  }

  console.log(fallos ? `\n${fallos} comprobaciones fallaron.` : '\nTodo correcto.');
  process.exit(fallos ? 1 : 0);
}

void main();
