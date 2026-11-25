import { sha256Hex } from './crypto';

/** Rutas donde se prueba una credencial: el acceso del conductor y el de la oficina. */
export function esAcceso(url: string): boolean {
  const ruta = url.split('?')[0];
  return ruta === '/v1/auth/driver' || ruta === '/v1/auth/session';
}

/** Un token de conductor de verdad es largo; algo más corto no merece cubo propio. */
const TOKEN = /^Bearer (\S{20,})$/;

/**
 * A nombre de quién se cuenta cada petición en el límite de tasa.
 *
 *  - **Accesos**: siempre por IP. Es donde se prueban PIN y contraseñas, y
 *    cada credencial inventada abriría un cubo nuevo (17/11/2026).
 *  - **Con clave de API**: por clave (el agente de n8n).
 *  - **Con token de conductor**: por token, no por IP (25/11/2026). Los
 *    operadores móviles sacan a muchos teléfonos por la misma dirección
 *    (CGNAT): con 300 conductores en turno, el tope de un teléfono lo
 *    compartía media flota, y en hora pico un «Aceptar» o un «Llegué» podían
 *    volver con 429 sin que nadie hubiera abusado de nada.
 *  - **El resto** (el panel, lo anónimo): por IP.
 *
 * La clave y el token van resumidos, nunca tal cual: esto acaba siendo el
 * nombre de una clave de Redis, y Redis no guarda secretos. SHA-256 basta: no
 * hay que verificar nada contra él, solo caer siempre en el mismo cubo.
 *
 * Un token inventado abre su propio cubo, igual que una clave inventada, y
 * tampoco consigue nada: la guarda lo rechaza con una sola consulta por
 * índice. Lo caro —Argon2— solo está en los accesos, que siguen por IP.
 */
export function claveDeLimite(peticion: {
  url: string;
  ip: string;
  apiKey?: string;
  authorization?: string;
}): string {
  if (esAcceso(peticion.url)) return `acceso:${peticion.ip}`;
  if (peticion.apiKey) return `k:${sha256Hex(peticion.apiKey)}`;
  const token = TOKEN.exec(peticion.authorization ?? '')?.[1];
  if (token) return `t:${sha256Hex(token)}`;
  return peticion.ip;
}
