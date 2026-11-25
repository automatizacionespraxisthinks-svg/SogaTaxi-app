# SogaTaxi — Puesta en marcha en el servidor

Los pasos concretos para este servidor, con sus valores reales. El porqué de
cada cosa está en `DESPLIEGUE.md`, que se escribió para Tax Turístico; donde
los dos digan algo distinto, manda este.

| Dato | Valor |
| --- | --- |
| Servidor | Contabo Cloud VPS 8 · `176.126.87.23` · región EU |
| Dokploy | `https://panel.praxisia.org` · proyecto **SogaTaxi** · entorno **production** |
| Repositorio | `automatizacionespraxisthinks-svg/SogaTaxi-app`, rama `main` |
| DNS | Hostinger, registro `A *.sogataxi` → `176.126.87.23` |

| Subdominio | Servicio de Dokploy | Puerto |
| --- | --- | --- |
| `api.sogataxi.praxisia.org` | `sogataxi-api` | 3000 |
| `panel.sogataxi.praxisia.org` | `sogataxi-panel` | 80 |
| `conductor.sogataxi.praxisia.org` | `sogataxi-conductor` | 80 |
| `chat.sogataxi.praxisia.org` | `chatwoot` | el de la plantilla |
| `n8n.sogataxi.praxisia.org` | `n8n` | el de la plantilla |

`postgres` y `memoria temporal` (Redis) **no** llevan subdominio: solo se
llega a ellos por la red interna.

**Contraseñas:** ninguna va en este archivo ni en el repositorio. Se generan
en el servidor y se guardan en el gestor de contraseñas.

## Avance

- **Paso 1, hecho el 25/11:** PostgreSQL 18.7 (`sogataxi-postgres-yoxvda`)
  con el usuario y la base `sogataxi`, sin puerto externo. Redis 8.12.0
  (`sogataxi-memoria-temporal-fcem9j`) con `noeviction`, sin puerto externo.
  En el servidor, `vm.overcommit_memory = 1` en
  `/etc/sysctl.d/99-redis.conf`.
- **Paso 2 y 3, hechos el 25/11:** secretos generados y `sogataxi-api`
  desplegada en `https://api.sogataxi.praxisia.org` (Let's Encrypt).
  `/ready` responde postgres y redis en `true`, CORS solo admite el panel
  y la PWA, HTTP redirige a HTTPS. Autodeploy apagado.
  - Primer arranque fallido por `password authentication failed for user
    "sogataxi"`: la contraseña de `DATABASE_URL` no era la del usuario. Se
    corrigió poniéndole al usuario la que tenía la API.
- **Pendiente en el servidor:** 3 actualizaciones de seguridad y un
  reinicio que pide Ubuntu. Hacerlo antes de abrir a los conductores.

---

## Paso 1 · Base de datos y Redis

1. En Dokploy, abrir **postgres** → **Deploy**. Esperar el punto verde.
   Igual con **memoria temporal**.
2. Entrar al servidor:

   ```powershell
   ssh root@176.126.87.23
   ```

3. Ver los nombres de los contenedores:

   ```bash
   docker ps --format "{{.Names}}" | grep -iE "postgres|redis|memoria"
   ```

4. Generar la contraseña del usuario de SogaTaxi y guardarla:

   ```bash
   openssl rand -hex 24
   ```

5. Crear el usuario y la base. `USUARIO_DE_DOKPLOY` es el de la pestaña
   *General* de postgres en Dokploy:

   ```bash
   docker exec -it CONTENEDOR_POSTGRES psql -U USUARIO_DE_DOKPLOY -d postgres -c "CREATE USER sogataxi WITH PASSWORD 'LA_CONTRASEÑA';" -c "CREATE DATABASE sogataxi OWNER sogataxi;"
   ```

   Responde `CREATE ROLE` y `CREATE DATABASE`. Las tablas las crea la API al
   arrancar. El usuario `sogataxi` no es superusuario a propósito: solo
   alcanza su propia base.

6. Comprobar la política de Redis:

   ```bash
   docker exec CONTENEDOR_REDIS redis-cli CONFIG GET maxmemory-policy
   ```

   Tiene que decir `noeviction`. Con otra, Redis puede borrar trabajos del
   despacho cuando le falte memoria.

7. Anotar el **Internal Host** de postgres y de memoria temporal (pestaña
   *General* de cada uno) y la contraseña de Redis (misma pestaña).

## Paso 2 · Generar los secretos

En el servidor, dos veces, y guardar cada uno con su nombre:

```bash
openssl rand -hex 32
```

- El primero es `SESSION_SECRET`.
- El segundo es `ENCRYPTION_KEY`. **Si se pierde, nadie de la oficina puede
  entrar** y hay que dar de alta el segundo factor de todos otra vez.

Las claves de push (VAPID), en este computador, dentro de la carpeta del
proyecto:

```powershell
pnpm --filter @tax/api exec node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Imprime `publicKey` y `privateKey`. Se generan una sola vez: si se cambian,
los conductores tienen que volver a permitir las notificaciones.

## Paso 3 · La API (`sogataxi-api`)

**Create Service → Application**, nombre `sogataxi-api`.

| Pestaña | Campo | Valor |
| --- | --- | --- |
| Source | Provider | GitHub |
| | Repository | `automatizacionespraxisthinks-svg/SogaTaxi-app` |
| | Branch | `main` |
| | Despliegue automático | **apagado** hasta terminar el piloto |
| Build | Build Type | Dockerfile |
| | Docker File | `apps/api/Dockerfile` |
| | Build Path / Context | `.` (la raíz, **no** `apps/api`) |
| Domains | Host | `api.sogataxi.praxisia.org` |
| | Container Port | `3000` |
| | HTTPS | sí, Let's Encrypt |

### Environment

Reemplazar lo que está en MAYÚSCULAS:

```
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

DATABASE_URL=postgres://sogataxi:CONTRASEÑA_POSTGRES@sogataxi-postgres-yoxvda:5432/sogataxi
DATABASE_POOL_MAX=10

REDIS_URL=redis://default:CONTRASEÑA_REDIS@sogataxi-memoria-temporal-fcem9j:6379/1
REDIS_PREFIX=sogataxi:

SESSION_SECRET=EL_PRIMERO_DEL_PASO_2
ENCRYPTION_KEY=EL_SEGUNDO_DEL_PASO_2
SESSION_TTL_HOURS=12

VAPID_PUBLIC_KEY=PUBLICKEY_DEL_PASO_2
VAPID_PRIVATE_KEY=PRIVATEKEY_DEL_PASO_2
VAPID_SUBJECT=mailto:CORREO_DE_CONTACTO

PUBLIC_ORIGINS=https://panel.sogataxi.praxisia.org,https://conductor.sogataxi.praxisia.org

# Solo se bajan fotos del lugar desde Chatwoot.
FOTO_HOSTS_PERMITIDOS=chat.sogataxi.praxisia.org

# Opcional: sin ella las direcciones escritas quedan «sin ubicar».
# GOOGLE_GEOCODING_API_KEY=

# Cuando n8n esté montado (nombre del servicio en la red interna).
# N8N_WEBHOOK_URL=http://SERVICIO_N8N:5678/webhook/RUTA
# N8N_WEBHOOK_SECRET=OTRO_openssl_rand_-hex_32

# Decisiones de la empresa, hoy en su valor por defecto.
OLEADA_FINAL_A_TODOS=true
BUSCAR_HASTA_CANCELAR=true

MAX_OPERADORES=5
MIN_DURACION_CARRERA_MIN=10
PHOTO_RETENTION_DAYS=30
POSITION_MAX_AGE_SECONDS=60
ARRIVAL_RADIUS_METERS=150
POSITION_REPORT_RIDE_SECONDS=2
POSITION_REPORT_IDLE_SECONDS=2
POSITION_RETENTION_DAYS=180
POSITION_PURGE_CRON=0 4 * * *
PURGE_TIMEZONE=America/Bogota

# Cuando se publique el APK (ver apps/conductor-android/README.md).
# APP_ANDROID_VERSION_CODE=5
# APP_ANDROID_VERSION_NAME=0.4.1
# APP_ANDROID_URL=https://conductor.sogataxi.praxisia.org/sogataxi-conductor.apk
```

- Los `HOST_INTERNO_*` son los de Dokploy, no `localhost` ni el nombre que
  sale en `docker ps`.
- Si una contraseña lleva `@`, `/`, `:`, `#` o `?`, hay que codificarla en
  la URL (`@` → `%40`). Las de `openssl rand -hex` nunca los llevan.
- Si están las claves VAPID y falta `VAPID_SUBJECT`, la API no arranca.

### Desplegar y comprobar

**Deploy**. En los registros deben salir `→ Aplicando migraciones…` y
`Migraciones al día.` La primera vez tarda varios minutos.

```powershell
curl.exe https://api.sogataxi.praxisia.org/ready
```

Tiene que responder con postgres y redis en `true`. Si alguno sale `false`,
el problema está en `DATABASE_URL` o `REDIS_URL`.

## Paso 4 · El panel (`sogataxi-panel`)

Igual que la API, cambiando:

| Campo | Valor |
| --- | --- |
| Docker File | `apps/admin/Dockerfile` |
| Build Arguments (no Environment) | `VITE_API_BASE=https://api.sogataxi.praxisia.org` |
| Host | `panel.sogataxi.praxisia.org` |
| Container Port | `80` |

Sin variables de entorno. El argumento va en **Build Arguments**: Vite lo
mete dentro del código al compilar.

## Paso 5 · La PWA del conductor (`sogataxi-conductor`)

| Campo | Valor |
| --- | --- |
| Docker File | `apps/driver/Dockerfile` |
| Build Arguments | `VITE_API_BASE=https://api.sogataxi.praxisia.org` |
| Host | `conductor.sogataxi.praxisia.org` |
| Container Port | `80` |

Desplegar de una en una: tres construcciones a la vez pueden agotar la
memoria.

### Repartir la app a los conductores (sin tiendas)

Un solo enlace para todos: **`https://conductor.sogataxi.praxisia.org/descargar`**.
La página detecta el teléfono:

- **Android:** descarga `sogataxi-conductor.apk`, firmado, servido por este
  mismo contenedor (`apps/driver/public/`, con su tipo MIME en
  `nginx.conf`). Para publicar una versión nueva: compilar el APK, copiarlo
  a `apps/driver/public/sogataxi-conductor.apk`, desplegar
  `sogataxi-conductor` y subir en la API `APP_ANDROID_VERSION_CODE`,
  `APP_ANDROID_VERSION_NAME` y `APP_ANDROID_URL` (ver Paso 3). La app
  avisa sola a los conductores.
- **iPhone:** explica cómo añadir la aplicación web a la pantalla de inicio
  desde Safari. Es la única forma de instalar en iPhone sin App Store ni
  cuenta de Apple Developer; se ve y se abre como una app y recibe avisos
  (iOS 16.4+).

## Paso 6 · Primer arranque

Desde el terminal del contenedor `sogataxi-api` en Dokploy:

1. Zonas: `node dist/cli/sembrar-produccion.js`
2. Primer administrador:
   `node dist/cli/crear-usuario.js USUARIO "Nombre Apellido" administrador`
   Imprime una contraseña temporal una sola vez.
3. Entrar a `https://panel.sogataxi.praxisia.org` y cambiar la contraseña.
4. Conductores: desde el listado maestro (`DESPLIEGUE.md` §4.4) o uno por uno
   en el panel.
5. Clave para n8n: `node dist/cli/crear-clave-api.js n8n rides:write rides:read`

**Nunca** ejecutar `dist/db/seed.js` en producción: crea conductores con un
PIN conocido. De todas formas se niega a correr con `NODE_ENV=production`.

## Paso 7 · Respaldo y comprobaciones

- Respaldo diario fuera de Contabo: `DESPLIEGUE.md` §5.
- Prueba de carga contra el servidor real:
  `apps/api/src/test/carga.ts` con `API_BASE` y `CARGA_FUERA_DE_LOCAL=si`.
  **Solo antes de abrir a los conductores**: crea conductores de prueba.
