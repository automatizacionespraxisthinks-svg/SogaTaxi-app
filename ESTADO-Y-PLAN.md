# SogaTaxi — Diagnóstico y plan de trabajo

Corte: 24/11/2026. Fuentes: `Reporte-estado-SogaTaxi-2026-11-24.pdf`, README,
DESPLIEGUE, revisión del código y verificación local.

## 1. Dónde estamos

| Bloque | Estado |
| --- | --- |
| API, panel, PWA (funciones del README) | Hecho |
| Marca SogaTaxi y paso a Sogamoso (mapa, geocodificación) | Hecho, con restos menores |
| Carreras creadas desde la oficina (migración 0028) | Hecho, falta en producción |
| App Android nativa (fase 2) | Probada en un OPPO, sin release |
| Zonas de despacho | Solo "Centro" provisional (2 km) |
| Producción (dominio, firma, FCM, piloto) | Pendiente |

Verificado en esta máquina con un clon limpio:

- `pnpm install`: bien.
- `typecheck` de los 6 paquetes: bien, **pero solo después de compilar
  `@tax/shared`**, y el README no lo menciona.
- Pruebas unitarias: 215 de 215. No incluye `exclusivity.spec.ts`, que
  necesita PostgreSQL.
- `pnpm -r build`: bien.

No verificado:

- Pruebas e2e (se corren a mano y usan coordenadas de Paipa).
- Prueba de concurrencia del despacho.
- Compilación de Android (aquí no hay JDK/SDK).

## 2. Qué hay que corregir antes de seguir avanzando

### Críticos
1. **`ENCRYPTION_KEY` de ceros es válida** (`apps/api/src/config/env.ts:68`).
   Hay que rechazar claves triviales en producción.
2. **Asignación manual que deja carreras colgadas.**
   - `dispatch.service.ts` (cerca de la línea 1122) marca NOTIFIED en una
     transacción y llama a `accept()` en otra.
   - Si `accept` falla, la carrera queda en NOTIFIED sin temporizador.
3. **Turno "zombi" en Android.**
   - Si Android revive el servicio con la app cerrada, falla
     `startForeground` y hace `stopSelf` (`TurnoService.kt:107`).
   - El conductor no recibe aviso, y la cabecera sigue en "En vivo" porque
     `alinearServicio` mira un dato en memoria.
4. **Despacho sin pruebas en Sogamoso.**
   - Los e2e usan coordenadas de Paipa.
   - `exclusivity.spec` no se puede correr sin Postgres.

### Importantes
- **Escalado de oleadas sin bloqueo.** `reject()`, `expireWave()` y
  `startWave()` leen el estado sin `FOR UPDATE`.
- **Valores por defecto de prueba.** `OLEADA_FINAL_A_TODOS=true` y
  `BUSCAR_HASTA_CANCELAR=true` tienen que ser una decisión explícita de la
  empresa.
- **El seed no se protege contra producción.** Deja un PIN y una contraseña
  conocidos.
- **Endpoints de lectura sin permiso.** Cualquier rol ve el teléfono del
  cliente y la foto en `GET /v1/admin/rides/:id`. Además, `/status` es
  público y muestra métricas.
- **`accept` no es idempotente.**
  - Un reintento tras caerse la red responde "otro aceptó".
  - Pausar el turno no revoca las ofertas pendientes.
- **Panel.** `JSON.parse` sin `try` en `apps/admin/src/api/client.ts:75`, y
  ni el panel ni la PWA tienen `ErrorBoundary`.
- **Batería en Android.** GPS de alta precisión cada 1 s todo el turno
  (también en pausa) y wake lock sin límite.
- **Fotos (SSRF).** Hay que definir siempre `FOTO_HOSTS_PERMITIDOS` en
  producción, porque existe riesgo de DNS rebinding.

### Menores
- **Restos de Tax Turístico:**
  - `VAPID_SUBJECT`.
  - `problem.ts:177` (`docs.taxturistico.co`).
  - El archivo `codigos-respaldo-tax-turistico.txt`.
  - El e2e de TOTP todavía espera `issuer=Tax`.
  - Nombres internos `hoyEnPaipa` y `ZONA_HORARIA_PAIPA`.
- **Logcat de release** con la dirección de recogida.
- **Cola Android** guardada con `apply()` en vez de `commit()`.
- **TOTP y códigos de respaldo** sin actualización condicional (dos accesos
  simultáneos con el mismo código pueden entrar los dos).
- **Librerías de Android** de finales de 2024.
- **Desarrollo.** La API no carga `.env` sola: falta
  `import 'dotenv/config'` en `main.ts`, antes de `app.module`.

## Avance (local, sin commit)

- **Fase 0, hecha el 24/11:**
  - Clon de git, pnpm, Docker, JDK 17 y Android SDK instalados.
  - La API lee `.env` sola y los scripts compilan `shared` antes.
  - Base migrada y sembrada; pasan las 220 pruebas, incluida la de
    concurrencia, y el APK compila.
- **Fase 1, hecha el 25/11:**
  - **Configuración:** ENCRYPTION_KEY y SESSION_SECRET triviales se
    rechazan en producción. VAPID_SUBJECT ya no tiene un valor por defecto
    de Tax Turístico.
  - **Despacho:**
    - Asignación manual en una sola transacción.
    - El escalado de oleadas se reserva una sola vez (Redis SET NX).
    - `startWave` no deja ofertas vivas sobre una carrera ya asignada.
    - El rechazo no le devuelve al conductor errores del despacho.
    - Aceptar dos veces la misma carrera es idempotente.
    - En pausa no se acepta, y pausar retira las ofertas pendientes.
  - **Datos y marca:** el seed se niega a correr en producción. Ya no
    quedan restos de taxturistico, y los nombres internos dicen «local» y
    no «Paipa».
  - **Android:**
    - Aviso y estado correcto cuando el turno se interrumpe.
    - GPS según la fase: en pausa, precisión media cada 30 s.
    - Candado de CPU con tope de 10 min, renovado cada 20 s.
    - Sin logcat en la versión de release.
    - La cola se guarda con `commit()`.
  - **Panel y PWA:** `JSON.parse` seguro en el panel y `ErrorBoundary`
    en las dos.
  - **Resultado:** pasan 226 pruebas y compilan el panel, la PWA y el
    APK, sin errores de lint.
- **Fase 2, hecha el 25/11:**
  - **Coordenadas:** las pruebas e2e ya están en Sogamoso.
    - `src/test/coordenadas.ts` define `CENTRO`.
    - Los demás puntos se trasladaron con el mismo desplazamiento (centro
      de Paipa → plaza de Sogamoso), así que las distancias entre ellos no
      cambiaron.
  - **Resultado:** pasan las **28 de 28** contra la API real, incluidas las
    del despacho, las oleadas, los relanzamientos, push y la purga (p95 de
    40 ms). También pasan las 226 unitarias.
  - **Pruebas desactualizadas que se corrigieron:**
    - `pago-y-suspension` no conocía la regla de vehículos permitidos.
    - `datos-personales` esperaba el redondeo de Paipa.
    - `push` esperaba un TTL fijo de 60 s.
  - **Para correrlas:**
    - Dejar unos 65 s entre una suite y otra: el límite es de 20 accesos
      por minuto por IP.
    - `ajustes-carrera` necesita la API con
      `FOTO_HOSTS_PERMITIDOS=127.0.0.1`.
    - `push` necesita `.certs/`, claves VAPID y
      `NODE_EXTRA_CA_CERTS`.
    - `listado-maestro` corre desde `dist/`.
    - `criticos` necesita dos claves: una con `rides:list` y otra sin él.
- **Auditoría del 25/11** (dos revisiones independientes del código, prueba
  nueva `e2e-endurecimiento.ts` y recorrido del panel en el navegador):
  - **Errores encontrados en los arreglos de la Fase 1, ya corregidos:**
    - La reserva del escalado duraba una hora. Si la API moría a mitad de
      una oleada, el reintento la encontraba tomada y la carrera quedaba
      «Notificada» para siempre. Ahora es un cerrojo de 30 s que se suelta
      al terminar, se vuelve a mirar la carrera tras tomarlo, y el barrido
      de cada minuto rescata las «Notificadas» sin ofertas vivas.
    - Android: el GPS podía quedar encendido tras cerrar la oficina el
      turno. El aviso de turno interrumpido compartía número con la
      notificación de la oferta y se borraban entre sí. En espera, la
      posición podía enviarse a la mitad del ritmo.
    - Panel: una respuesta buena cortada a la mitad se daba por recibida.
  - **Errores anteriores a la Fase 1, corregidos:**
    - Dos accesos simultáneos con el mismo código del segundo factor (o
      el mismo código de respaldo) entraban los dos.
    - Pausar no le quitaba la oferta de la pantalla al conductor.
    - Una oleada que salía justo cuando cancelaban o asignaban a mano la
      carrera dejaba ofertas vivas.
    - Android: con la sesión rechazada (401) en segundo plano, el servicio
      seguía con GPS y CPU despiertos; un 200 sin JSON tumbaba la app; al
      cerrar la oficina la sesión se perdían las etapas sin enviar.
  - **Nuevo en Android:** aviso «No llega tu ubicación» si pasan dos
    minutos de turno sin una lectura de GPS.
  - **Al desplegar:** si producción tiene claves VAPID pero no
    `VAPID_SUBJECT`, la API no arranca (antes había un valor por defecto de
    Tax Turístico). Revisarlo en Dokploy antes de subir. En producción la
    API avisa en el registro si `FOTO_HOSTS_PERMITIDOS` está vacío.
- **Sin cambiar todavía (son decisiones, no código):** permisos de lectura
  en `GET /v1/admin/rides/:id` (no existe un permiso `carreras.ver`: hoy
  cualquier rol con sesión ve teléfono y foto), `/status` público, que la
  clave de n8n pueda asignar a mano (`POST /v1/rides/:id/assign` con
  `rides:write`), `OLEADA_FINAL_A_TODOS` y `BUSCAR_HASTA_CANCELAR`.
- **Pendiente técnico conocido:** la descarga de fotos por enlace, sin
  `FOTO_HOSTS_PERMITIDOS`, comprueba la IP y luego vuelve a resolver el
  nombre (rendija de DNS rebinding). Se cierra del todo poniendo la lista
  en producción.

## Requisito: Android y iPhone (25/11)

> **Decisión final (25/11): Android con la app nativa, iPhone con la PWA.**
> No se tramita cuenta de Apple ni se publica app de iPhone. El código de
> iPhone descrito abajo queda guardado en el proyecto y compila, por si
> más adelante se retoma. En iPhone el conductor trabaja con el teléfono en
> soporte y la pantalla encendida.

La aplicación del conductor tiene que funcionar en los dos sistemas. Se
decidió hacerlo con **Kotlin Multiplatform**: una sola app, no dos.

- **Hecho el 25/11 (local, sin commit):** la app Android se convirtió a
  Kotlin Multiplatform con Compose Multiplatform
  (`apps/conductor-android`).
  - `shared/`: sesión, cola, API, motor del turno, ofertas y todas las
    pantallas, comunes a los dos sistemas.
  - `app/`: lo que solo es de Android (servicio en primer plano,
    notificación de pantalla completa, Keystore).
  - `shared/src/iosMain` e `iosApp/`: lo de iPhone (GPS en segundo plano,
    notificaciones, Llavero, socket).
  - El turno abierto dejó de vivir en el servicio de Android: ahora es
    `MotorDeTurno`, el mismo en los dos.
- **Verificado en este equipo:** 13 pruebas nuevas del código común, APK
  de depuración y de release, lint de Android sin errores, y el código de
  iPhone compila contra el SDK de iOS (`compileKotlinIosArm64` y
  simulador).
- **Sin verificar:**
  - La app Android nueva no se ha instalado en un teléfono. Es una
    reorganización grande de la que sí estaba probada: hay que repetir las
    pruebas del README (alerta bloqueado, GPS con pantalla apagada, carrera
    completa, turno largo).
  - La app de iPhone no se ha enlazado ni ejecutado nunca. El Swift de
    `iosApp/` (unas 150 líneas) está escrito sin compilar.
- **Qué hace falta para iPhone:** cuenta Apple Developer de la empresa
  (99 USD al año), un Mac con Xcode o compilación en la nube, y
  distribución por TestFlight / App Store.
- **Diferencias en iPhone:** la oferta no enciende la pantalla sola (iOS no
  lo permite); llega como notificación con sonido de alarma de 28 s, que
  respeta el modo silencio. La alarma en bucle solo suena con la app en
  pantalla. La app declara el modo de fondo `location`, que Apple revisa.
- **Consecuencia para la Fase 3:** el push de la API se diseña para los dos
  sistemas (Firebase entrega a Android y, vía APNs, a iPhone). En iPhone
  el push pesa más que en Android: es lo único que despierta la app si iOS
  la cerró.
- **La PWA sigue** como respaldo en los dos sistemas.
- **Distribución (decidido el 25/11): sin tiendas públicas.** La empresa
  quiere enviar la app y que se instale directo.
  - Android: se puede tal cual, con un APK firmado. Falta la firma de
    release y un aviso de versión nueva dentro de la app.
  - iPhone: Apple no deja instalar un archivo suelto. Lo más parecido es
    Ad Hoc (enlace propio, cada iPhone registrado, tope de 100 al año,
    se renueva cada año) o una app «no listada» (enlace privado, pasa
    revisión de Apple una vez). Las dos exigen la cuenta Apple Developer.

## Varias empresas (decidido el 25/11)

El sistema se vende a varias empresas (Paipa, 70 conductores; Sogamoso,
300). Se evaluó unificar todo en un mismo código con una app única, y **se
decidió seguir con cada empresa por aparte**: su propio código, su propia
app y su propia instalación. Este repositorio es solo SogaTaxi.

- **Servidor:** Contabo Cloud VPS 8 (8 núcleos, 24 GB). Alcanza para las
  dos empresas; falta medir la carga real de 300 conductores.
- **Consecuencias a tener presentes:**
  - Un arreglo hecho aquí hay que llevarlo a mano al código de Paipa.
  - En iPhone, cada empresa necesita su propia cuenta Apple Developer para
    publicar su app (Apple rechaza apps casi iguales desde una misma
    cuenta).
- **Prueba de carga (25/11), `apps/api/src/test/carga.ts`:** flota
  simulada con socket abierto, posición cada 2 s y carreras a ritmo de hora
  pico, contra la API compilada en el portátil de desarrollo.

  | | 300 conductores, 20 carreras/min | 600 conductores, 60 carreras/min |
  | --- | --- | --- |
  | Posiciones por segundo | 150 | 300 |
  | Posición, p95 / máximo | 81 ms / 120 ms | 100 ms / 212 ms |
  | Posiciones fallidas | 0 de 25.457 | 0 de 41.983 |
  | De crear la carrera a la primera oferta, p95 | 159 ms | 219 ms |
  | Carreras que llegaron a un teléfono | 40 de 40 | 90 de 90 |
  | Memoria de la API | 258 a 438 MB | 418 a 479 MB |

  - Sin errores en el registro de la API en ninguna de las dos.
  - Lo que la prueba **no** cubre: el envío de push (los conductores de
    prueba no tienen suscripción), n8n, el geocodificador de Google, la red
    móvil real y el servidor de producción. Hay que repetirla allá antes de
    salir en vivo.
  - Deja 600 conductores de prueba inactivos (códigos 9001 a 9600,
    `es_prueba`) en la base de desarrollo.
- **Límite de peticiones, corregido el 25/11:** se contaba por IP, y los
  operadores móviles sacan a muchos teléfonos por la misma. Ahora cada
  conductor tiene su propio tope (`common/limite.ts`); los accesos siguen
  por IP. Probado en vivo con `e2e-limite.ts`.
- **Pendiente con 300 conductores:** repetir la prueba de carga en el
  servidor real.

## Fase 3, avance del 25/11 (local, sin commit)

- **Hecho:**
  - **Firma del APK:** la versión final se firma con la llave de
    `keystore.properties` (fuera de git). Probado con una llave de prueba:
    sale `app-release.apk` firmado. La llave real la crea la empresa (pasos
    en el README de la app).
  - **Aviso de versión nueva:** la API publica la versión
    (`GET /v1/app/conductor-android`, variables `APP_ANDROID_*`) y la app
    muestra una franja con el botón de descarga. Una versión mínima
    obligatoria impide abrir turno, nunca corta una carrera.
  - **Respaldo diario:** `scripts/respaldo.sh`. Probada la copia y la
    restauración en una base vacía. Falta instalarlo en el VPS con el
    destino externo; el cifrado y la subida no se probaron aquí.
  - **Límite de peticiones por conductor** (ver arriba).
- **Verificado:** 239 pruebas de la API, 16 del código común de la app,
  tipos de los 6 paquetes, APK de depuración y final, lint sin errores,
  código de iPhone compila, y en vivo: despacho, endurecimiento y límite.
- **Sin verificar:** el aviso de versión y el APK nuevo en un teléfono.
- **Lo que queda de la Fase 3 depende de la empresa:**
  - Dominio HTTPS de producción (va en `API_BASE` del APK y en Dokploy).
  - La llave de firma real y dónde se guarda.
  - Destino externo de los respaldos (cuenta en otro proveedor).
  - Proyecto de Firebase, si se quiere push nativo en Android. Hoy la app
    Android recibe las ofertas por el socket, que el servicio de turno
    mantiene vivo; el push sería el respaldo si Android mata la app.
  - Zonas definitivas de Sogamoso, aviso de la Ley 1581 y las decisiones
    de permisos anotadas arriba.
  - Desplegar en el VPS y repetir allá la prueba de carga.

## 3. Ruta propuesta

**Fase 0 — Entorno y repositorio**
- Clonar con git, no usar el zip.
- Instalar pnpm, Docker Desktop, y JDK 17 con el Android SDK.
- Arreglar el arranque: `dotenv` en `main.ts` y el paso de compilar
  `shared` en el README.

**Fase 1 — Endurecer (código, sin depender de la empresa)**
- Críticos 1 a 3 y los importantes de la API.
- Arreglos de la app Android: zombi, batería, logcat y cola.
- Errores del panel.
- Restos de marca.

**Fase 2 — Pruebas**
- Centralizar las coordenadas de los e2e en `src/test/coordenadas.ts`, con
  Sogamoso.
- Correr `exclusivity.spec` y los e2e de despacho, oleadas, relanzar y
  críticos con Postgres.

**Fase 3 — Producción (necesita decisiones de SogaTaxi)**
- Dominio HTTPS y `API_BASE` de release.
- Firma del APK y canal de distribución (APK con actualizador propio o
  Google Play administrado).
- FCM con un proyecto Firebase de la empresa (también en la API).
- Zonas definitivas.
- Desplegar la migración 0028.
- Aviso de la Ley 1581 para los pedidos por teléfono.
- iPhone: cuenta Apple Developer, cómo compilar (Mac o nube) y si el
  piloto arranca con la PWA.
- Municipios vecinos.
- Valores de oleadas.
- Qué roles ven datos del cliente.

**Fase 4 — Piloto**
- 3 o 4 conductores, con varias marcas de teléfono.
- Turno de 4 h o más, medir batería.
- Medir la cola sin señal en modo avión.
- Mantener la PWA como respaldo.

**Después:** Chatwoot, cola en IndexedDB para fotos, retención de las demás
tablas (§9.3).
