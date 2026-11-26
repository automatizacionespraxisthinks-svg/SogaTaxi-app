import { z } from 'zod';

/**
 * Configuración del proceso.
 *
 * Todo entra por variables de entorno de Dokploy; nada de secretos en el
 * repositorio (§8.2). Si falta algo o viene mal, el proceso no arranca: es
 * preferible no levantar a levantar a medias y fallar en la primera carrera.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Base `tax` dentro del PostgreSQL 16 existente, con usuario propio. */
  DATABASE_URL: z.string().url(),
  /** El pool se limita a 10 conexiones para convivir en el VPS (§4.2). */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  /** Redis 7 existente, usuario ACL `tax` limitado al prefijo `tax:`. */
  REDIS_URL: z.string().url(),
  REDIS_PREFIX: z.string().default('tax:'),
  /**
   * De quién se cree la cabecera X-Forwarded-For (17/11/2026). Con `true`
   * se creía de cualquiera, así que quien llegara a la API sin pasar por
   * Traefik elegía su IP: la del límite de peticiones, la de la bitácora y
   * la del bloqueo de accesos. Por defecto, solo las redes privadas, que es
   * donde vive Traefik en Docker. Admite la sintaxis de `proxy-addr`.
   */
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
  /**
   * De qué servidores se pueden bajar fotos del lugar (17/11/2026), separados
   * por coma, por ejemplo el de Chatwoot: `chat.example.com`. Con la
   * lista, solo esos (y sus subdominios), aunque sean internos. Sin ella,
   * cualquiera que no sea una dirección privada o del propio servidor.
   */
  FOTO_HOSTS_PERMITIDOS: z
    .string()
    .default('')
    .transform((valor) =>
      valor
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),

  /** Webhooks hacia n8n, firmados con HMAC-SHA256 (§7.1). */
  N8N_WEBHOOK_URL: z.string().url().optional(),
  N8N_WEBHOOK_SECRET: z.string().min(32).optional(),
  /** Reintentos del relay del outbox: 1 s → 15 min, 10 intentos. */
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(10),

  /**
   * Web Push (ADR-07): despierta la PWA instalada cuando el socket está
   * caído. Sin claves, la API funciona igual y solo avisa por socket; es
   * degradación, no fallo.
   */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  /**
   * Contacto que el servicio de push usa si hay un problema con los envíos.
   * Sin valor por defecto: el de antes era el correo de Tax Turístico. Es
   * obligatorio solo si hay claves VAPID (ver la comprobación de abajo).
   */
  VAPID_SUBJECT: z.string().startsWith('mailto:').optional(),

  /** Cookie de sesión de la oficina. */
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(12),

  /** Clave de cifrado a nivel de aplicación para columnas sensibles
      (documento del conductor, secreto TOTP): 32 bytes en hexadecimal. */
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'Debe ser 32 bytes en hexadecimal'),

  /**
   * Clave de la API de Geocoding de Google.
   *
   * Es opcional a propósito. Sin ella la API no adivina direcciones: exige
   * que la carrera llegue con coordenadas, como antes. Es preferible pedir
   * la ubicación a mandar un taxi a un punto inventado.
   */
  GOOGLE_GEOCODING_API_KEY: z.string().min(20).optional(),

  /*
   * Carreras sin conductor (19/11/2026). Agotadas las oleadas, el sistema la
   * relanza solo tantas veces como diga RELANZAMIENTOS_AUTOMATICOS, esperando
   * RELANZAMIENTO_ESPERA_SEG para que antes le llegue al cliente «Estamos
   * buscando un vehículo». Si tampoco así la toma nadie, la cierra y le pide
   * al cliente que vuelva a intentarlo. Con 0 no relanza: la cierra al agotar
   * las oleadas.
   *
   * CADUCIDAD_SIN_CONDUCTOR_MIN es la red de seguridad: una carrera que se
   * queda sin asignar más de esos minutos (la dejó así la oficina, o se
   * perdió un temporizador) se cierra por inactividad.
   */
  RELANZAMIENTOS_AUTOMATICOS: z.coerce.number().int().min(0).max(5).default(1),
  RELANZAMIENTO_ESPERA_SEG: z.coerce.number().int().min(5).max(600).default(20),
  CADUCIDAD_SIN_CONDUCTOR_MIN: z.coerce.number().int().min(2).max(240).default(10),

  /*
   * Buscar hasta que el cliente cancele (21/11/2026, decisión de la empresa).
   * Encendido, las dos salidas de arriba dejan de cerrar la carrera: agotadas
   * las oleadas se relanza siempre, y una que se quedó quieta sin asignar se
   * relanza en vez de caducar. Solo la cierra el cliente (por el chat), la
   * oficina o el conductor. Desde el segundo intento el aviso a los
   * conductores sale como urgente.
   *
   * Entre un intento y el siguiente se espera RELANZAMIENTO_ESPERA_SEG la
   * primera vez y REINTENTO_URGENTE_ESPERA_SEG las demás: sin conductores en
   * turno, las oleadas vacías se agotan al instante y sin esa pausa la
   * carrera daría vueltas sin parar.
   */
  BUSCAR_HASTA_CANCELAR: z
    .enum(['true', 'false'])
    .default('true')
    .transform((valor) => valor === 'true'),
  REINTENTO_URGENTE_ESPERA_SEG: z.coerce.number().int().min(5).max(900).default(45),

  /*
   * Avisos que no se confirman (21/11/2026). El teléfono confirma cada aviso
   * de oferta al recibirlo; si a los AVISO_REENVIO_SEG no lo ha confirmado y
   * la oferta sigue viva, se le vuelve a mandar una vez. 0 lo apaga.
   */
  AVISO_REENVIO_SEG: z.coerce.number().int().min(0).max(120).default(15),

  /**
   * WAHA, para vigilar las líneas de WhatsApp (§10.4). Dentro de Dokploy es
   * el nombre del servicio en la red interna, p. ej. `http://tax-turistico-waha-xxxx:3000`.
   *
   * Opcional: sin ella el monitor no arranca y el panel lo dice. Antes la
   * página de estado prometía «revisión cada minuto» sin que nada revisara.
   */
  WAHA_URL: z.string().url().optional(),
  /** La clave que WAHA exige en `X-Api-Key`, si tiene una configurada. */
  WAHA_API_KEY: z.string().min(8).optional(),

  /**
   * Cuántos operadores activos puede haber a la vez. Los administradores no
   * cuentan: se crean desde el terminal del servidor, no desde el panel.
   */
  MAX_OPERADORES: z.coerce.number().int().min(1).max(50).default(5),

  /** Orígenes autorizados del panel y de la PWA. */
  PUBLIC_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  /**
   * Posición: hasta qué antigüedad cuenta como «reciente» (§5.2).
   *
   * No es un descarte. Los de posición reciente se ofrecen primero, y solo
   * si no hay ninguno se ofrece con la última posición conocida: mejor eso
   * que dejar la carrera sin nadie.
   */
  POSITION_MAX_AGE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  /*
   * La oleada 1 es la de «el taxi que está a pocas cuadras» (26/11/2026). Una
   * posición de hace más de esto no prueba que el taxi siga ahí, así que ese
   * conductor no entra en la oleada 1: la recibe desde la 2.
   *
   * No se usa POSITION_MAX_AGE_SECONDS (1 min) a propósito: un teléfono
   * bloqueado deja de reportar —sobre todo la PWA en iPhone— y la empresa
   * decidió el 3/11/2026 que guardar el celular no puede dejar a un conductor
   * sin la carrera. Diez minutos deja pasar ese caso y saca al que lleva
   * media hora sin reportar. Cuando todos usen la app de Android, que reporta
   * en segundo plano, se puede bajar.
   */
  POSITION_OLEADA1_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(3600).default(600),

  /*
   * Cada cuánto manda su posición la PWA, y cada cuánto se guarda en
   * Postgres. Son dos cosas distintas y por eso son dos pares de variables:
   *
   *  - ENVÍO: de la PWA a la API. Es lo que ve el panel, porque cada POST
   *    emite `driver:moved` por el socket. Bajarlo mueve los taxis del mapa
   *    más seguido; cuesta datos del conductor y peticiones a la API, no
   *    espacio en la base.
   *  - MUESTREO: de la API a `driver_positions`. Es el histórico del
   *    recorrido, lo que llena la base y lo que luego purga la limpieza de
   *    madrugada. Se deja aparte a propósito: el panel puede ir a dos
   *    segundos sin que el histórico crezca quince veces.
   *
   * La PWA recibe los dos de envío en `/me`, así que cambiarlos aquí no
   * obliga a recompilarla: el conductor los toma al abrir o al reconectar.
   */
  POSITION_REPORT_RIDE_SECONDS: z.coerce.number().int().min(1).max(120).default(2),
  POSITION_REPORT_IDLE_SECONDS: z.coerce.number().int().min(1).max(300).default(2),
  POSITION_SAMPLE_RIDE_SECONDS: z.coerce.number().int().min(1).max(600).default(10),
  POSITION_SAMPLE_IDLE_SECONDS: z.coerce.number().int().min(1).max(900).default(30),
  /**
   * Minutos que tienen que pasar desde «Pasajero a bordo» para poder
   * finalizar. Una carrera de dos minutos en Paipa no existe: si aparece, es
   * un conductor cerrando carreras que no hizo.
   *
   * Es el único sitio donde vive el número: la PWA lo recibe en `/me` y pinta
   * la cuenta atrás con él, así que cambiarlo aquí no obliga a recompilarla
   * ni a tocar nada más. Con `0` la restricción queda desactivada.
   */
  MIN_DURACION_CARRERA_MIN: z.coerce.number().int().min(0).max(120).default(10),

  /** Radio en el que «Llegué» no cuenta como excepción (§5.3). */
  ARRIVAL_RADIUS_METERS: z.coerce.number().int().min(20).max(1000).default(150),

  /*
   * Borrado del histórico de GPS (§9.3).
   *
   * La tabla `driver_positions` es el recorrido minuto a minuto de toda la
   * plantilla, así que no se guarda más de lo necesario. El plazo del
   * documento son seis meses, y el propio documento lo marca «a confirmar
   * con la empresa»: cambiarlo es una decisión suya, no del código.
   */
  POSITION_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  /** Fotos del lugar que manda el cliente: puede verse su casa (§9.3). */
  PHOTO_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Filas por lote. Pequeño para no inflar el WAL ni retener bloqueos. */
  POSITION_PURGE_BATCH: z.coerce.number().int().min(100).max(50_000).default(5_000),
  /** Pausa entre lotes: deja respirar al despacho y a autovacuum. */
  POSITION_PURGE_PAUSE_MS: z.coerce.number().int().min(0).max(60_000).default(2_000),
  /**
   * Tope por ejecución. La primera purga sobre meses de atraso podría durar
   * horas; con el tope se reparte en varias noches y ninguna se desmadra.
   */
  POSITION_PURGE_MAX_ROWS: z.coerce.number().int().min(1_000).default(2_000_000),
  /** De madrugada, hora de Colombia: es cuando casi no hay carreras. */
  POSITION_PURGE_CRON: z.string().default('0 4 * * *'),
  PURGE_TIMEZONE: z.string().default('America/Bogota'),

  /**
   * La app Android del conductor se instala desde un APK que entrega la
   * empresa, sin tienda: la versión publicada se declara aquí y la app la
   * consulta (`GET /v1/app/conductor-android`). Al subir un APK nuevo se
   * cambian el número y, si hace falta, el enlace.
   *
   * `APP_ANDROID_MIN_VERSION_CODE`: por debajo de esa, la app no deja abrir
   * turno hasta actualizar. Para cuando una versión vieja ya no se entiende
   * con la API.
   */
  APP_ANDROID_VERSION_CODE: z.coerce.number().int().min(1).optional(),
  APP_ANDROID_VERSION_NAME: z.string().max(40).optional(),
  APP_ANDROID_URL: z.string().url().max(500).optional(),
  APP_ANDROID_MIN_VERSION_CODE: z.coerce.number().int().min(1).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
}).superRefine((env, ctx) => {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && !env.VAPID_SUBJECT) {
    ctx.addIssue({
      code: 'custom',
      path: ['VAPID_SUBJECT'],
      message: 'Con claves VAPID hace falta el contacto (mailto:...) de SogaTaxi',
    });
  }

  if (env.NODE_ENV !== 'production') return;

  // El conductor instala lo que baje de este enlace: por HTTP cualquiera en
  // su red podría cambiarle el APK por otro.
  if (env.APP_ANDROID_URL && !env.APP_ANDROID_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_ANDROID_URL'],
      message: 'El enlace de descarga de la app tiene que ser HTTPS',
    });
  }

  // En producción no se arranca con los secretos de ejemplo: el
  // .env.example trae una ENCRYPTION_KEY de ceros que cumple el formato, y
  // con ella el secreto TOTP y las cédulas quedarían cifrados con una clave
  // conocida.
  if (claveTrivial(env.ENCRYPTION_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['ENCRYPTION_KEY'],
      message: 'Es una clave de ejemplo o trivial. Genera una con: openssl rand -hex 32',
    });
  }
  if (/cambia-esto/i.test(env.SESSION_SECRET) || claveTrivial(env.SESSION_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['SESSION_SECRET'],
      message: 'Es el secreto de ejemplo o uno trivial. Genera uno con: openssl rand -hex 32',
    });
  }
});

/**
 * Una clave «trivial» repite muy pocos caracteres (ceros, «aaaa…», «0101…»).
 * Una aleatoria de 64 hex usa casi siempre los 16 dígitos; con menos de 8
 * distintos es casi seguro que alguien la escribió a mano.
 */
export function claveTrivial(valor: string): boolean {
  return new Set(valor.toLowerCase()).size < 8;
}

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Valida sin guardar en caché: para las pruebas. */
export function validarEnv(source: NodeJS.ProcessEnv) {
  return envSchema.safeParse(source);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = validarEnv(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${detail}`);
  }

  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
