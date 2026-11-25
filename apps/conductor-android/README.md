# SogaTaxi Conductor — app nativa para Android y iPhone

Una sola app para los dos sistemas, con Kotlin Multiplatform y Compose
Multiplatform. La carpeta se sigue llamando `conductor-android` porque nació
como app de Android.

## Cómo está armada

| Carpeta | Qué tiene | Dónde corre |
| --- | --- | --- |
| `shared/src/commonMain` | Sesión, cola sin señal, API, motor del turno, ofertas y **todas las pantallas** | Android y iPhone |
| `shared/src/androidMain` | Pedir permisos y decodificar la foto | Android |
| `shared/src/iosMain` | GPS en segundo plano, notificaciones, red y alarma del iPhone | iPhone |
| `app/` | Servicio en primer plano, notificación de pantalla completa, Keystore | Android |
| `iosApp/` | Arranque en Swift, Llavero y socket | iPhone |

La frontera entre lo común y lo de cada sistema es `Plataforma.kt`: ahí está
la lista de lo que el código común le pide al teléfono. `MotorDeTurno.kt` es
el turno abierto (GPS, socket, cola, vigilancias) y es el mismo en los dos;
en Android lo sostiene `TurnoService` y en iPhone la ubicación en segundo
plano (`TurnoIos.kt`).

## Estado de cada sistema

- **Android:** compila, pasa lint y las pruebas del código común. La versión
  anterior a esta estructura fue la que se probó en un OPPO; **esta todavía
  no se ha instalado en un teléfono**. Hay que repetir las pruebas de abajo.
- **iPhone:** el código Kotlin compila contra el SDK de iOS (se comprueba
  también desde Windows). **La app no se ha enlazado ni ejecutado nunca**:
  hace falta un Mac con Xcode y una cuenta Apple Developer. El Swift de
  `iosApp/` está escrito sin compilar.

## Historia

Reemplazo nativo de la PWA de conductores. La fase 0 comprobó en un OPPO
con ColorOS 14 lo que la PWA no puede hacer: GPS con el teléfono bloqueado
(24,6 min sin un hueco de más de 13 s) y ofertas que encienden la pantalla.
La fase 2 la lleva a la par de la PWA.

## Qué hace (fase 2)

- **Una pantalla por estado**, como la PWA: acceso, fuera de turno, en turno
  (esperando o en pausa), carrera y resumen (`Sesion.kt`, `Pantallas.kt`,
  `PantallaCarrera.kt`).
- **El estado sale de `GET /v1/driver/rides/me`** y se guarda en el teléfono:
  abierta sin señal, la app vuelve a la carrera o al turno donde estaba. Un
  401 no borra el token (suele ser una suspensión de la oficina).
- **Carrera**: banda de color por estado (negro en camino, rojo en el lugar,
  verde en curso), recogida, referencia, notas, foto del lugar, medio de
  pago, distancia a la recogida, **Ir con Maps / Ir con Waze** (los mismos
  enlaces que la PWA), **Llamar** al cliente, y la etapa siguiente en un
  botón grande. "Finalizar" lleva la cuenta atrás del mínimo a bordo.
- **Cancelar con motivo** (la lista de `cancelacion.ts`), solo antes de
  recoger al cliente.
- **Cola sin señal** (`Cola.kt`): las etapas (llegué, a bordo, finalizar) se
  guardan y la pantalla avanza; se reenvían al reconectar el socket, al
  volver la red o cada 20 s, con su clave de idempotencia. Aceptar,
  cancelar, abrir/cerrar turno y cambiar de carro van directo.
- **Vehículos permitidos** como botones al abrir turno, **cambiar de carro**
  con el turno abierto y **cambiar de conductor** (no deja salir con etapas
  sin enviar).
- **Seguridad**: el token va cifrado con una llave del Keystore de Android
  (`Cifrado.kt`) y, en iPhone, en el Llavero (`Puente.swift`). La versión final solo habla HTTPS; HTTP solo existe en la
  de depuración (`src/debug/res/xml/network_security_config.xml`).

## Pendiente

- El **dominio de producción** de la API (`API_BASE` de `release` en
  `app/build.gradle.kts`).
- **FCM** como respaldo de las ofertas, cuando exista el proyecto de
  Firebase de SogaTaxi.
- **Actualizador propio** para la distribución privada, y la firma de la
  versión final.

1. **GPS con la pantalla bloqueada.** El turno abierto es un servicio en
   primer plano de tipo `location` (`TurnoService.kt`). Android no congela el
   GPS al bloquear el teléfono ni al cambiar de app.
2. **Ofertas que suenan con el teléfono bloqueado.** `ride:offer` llega por
   el mismo socket `/rt` de la PWA, que sigue vivo dentro del servicio. Abre
   una pantalla completa encima del bloqueo, como una llamada entrante, con la
   alarma del teléfono en bucle hasta contestar o hasta que venza
   (`Oferta.kt`, `OfertaActivity.kt`, `Alarma.kt`).

Usa **la misma API sin cambios**: `/v1/auth/driver`, `/v1/driver/shift/*`,
`/v1/driver/position`, `/v1/driver/rides/*` y el socket `/rt`.

## Compilar

Requiere JDK 17 y el Android SDK en `%LOCALAPPDATA%\Android\Sdk`
(`local.properties`), con las licencias aceptadas:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
```

```powershell
cd apps\conductor-android; .\gradlew.bat :app:assembleDebug
```

El APK queda en `app\build\outputs\apk\debug\app-debug.apk`. Se instala con
`adb install -r` o copiándolo al teléfono.

Antes de dar por bueno un cambio, todo lo que se puede comprobar en Windows:

```powershell
cd apps\conductor-android; .\gradlew.bat :shared:testDebugUnitTest :app:assembleDebug :app:lintDebug :shared:compileKotlinIosArm64
```

`compileKotlinIosArm64` compila el código de iPhone (común + `iosMain`) y
falla si algo no encaja con el SDK de iOS. La primera vez descarga el
compilador de Kotlin/Native y tarda varios minutos.

## Firmar la versión final

Android solo instala una versión nueva encima de la anterior si las dos
están firmadas con la misma llave. **Esa llave se crea una vez y no se puede
perder**: sin ella, todos los conductores tendrían que desinstalar la app y
volver a entrar.

1. Crear la llave (pide una contraseña; vale 30 años):

   ```powershell
   & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore sogataxi-conductor.jks -alias sogataxi -keyalg RSA -keysize 2048 -validity 10950
   ```

2. Guardar `sogataxi-conductor.jks` y su contraseña en dos sitios seguros
   fuera de este equipo (un gestor de contraseñas y una copia aparte).
3. Crear `apps/conductor-android/keystore.properties` (no va en git):

   ```properties
   storeFile=C:/ruta/segura/sogataxi-conductor.jks
   storePassword=...
   keyAlias=sogataxi
   keyPassword=...
   ```

4. Compilar:

   ```powershell
   cd apps\conductor-android; .\gradlew.bat :app:assembleRelease
   ```

   Sale `app\build\outputs\apk\release\app-release.apk`, firmado. Sin
   `keystore.properties` sale `app-release-unsigned.apk`, que no se instala.

Antes de compilar la versión final hay que poner el dominio de producción en
`API_BASE` de `release` (`app/build.gradle.kts`).

## Publicar una versión nueva

La app no pasa por una tienda, así que ella misma avisa cuando hay versión
nueva. El conductor ve una franja «Hay una versión nueva» con el botón
**Actualizar**, que abre la descarga.

1. Subir `versionCode` (y `versionName`) en `app/build.gradle.kts`.
2. Compilar firmada (`:app:assembleRelease`).
3. Subir el APK a una dirección HTTPS. Lo más simple es dejarlo junto a la
   PWA del conductor.
4. En el entorno de la API, poner el número y el enlace, y redesplegar:

   ```
   APP_ANDROID_VERSION_CODE=4
   APP_ANDROID_VERSION_NAME=1.0.1
   APP_ANDROID_URL=https://conductor.tu-dominio/sogataxi-conductor.apk
   ```

- La app pregunta al abrirse y cada media hora.
- En carrera no se muestra el aviso.
- `APP_ANDROID_MIN_VERSION_CODE` obliga: por debajo de esa versión no se
  puede abrir turno hasta actualizar. Para cuando una versión vieja ya no se
  entiende con la API. Nunca corta una carrera en curso.
- La primera instalación sigue siendo a mano: enviar el APK o el enlace, y
  el conductor acepta «instalar apps desconocidas».

## iPhone

Necesita un Mac con Xcode 15 o superior, JDK 17 y la cuenta Apple Developer
de la empresa.

1. `brew install xcodegen`
2. `cd apps/conductor-android/iosApp && xcodegen` crea
   `SogaTaxiConductor.xcodeproj` a partir de `project.yml`.
3. Abrir el proyecto en Xcode, elegir el equipo de firma (`DEVELOPMENT_TEAM`
   en `project.yml`) y ejecutar en un iPhone. Xcode llama a Gradle para
   compilar el código común en cada compilación.

Pendiente en `project.yml`: el equipo de firma, el icono de la app y el
dominio de producción (`API_BASE` de `Release`).

Diferencias con Android que el conductor va a notar:

- **La oferta no enciende la pantalla sola.** iOS no lo permite a una app
  normal. Llega como notificación con el sonido de alarma de la app
  (`oferta.wav`, 28 s); al tocarla, la oferta está en pantalla. Con la app
  abierta se ve a pantalla completa y la alarma suena en bucle.
- **Barra azul de ubicación** mientras el turno está abierto, en vez de la
  notificación fija «En turno».
- **Sin ajuste de batería ni de pantalla completa**: la lista «Falta
  permitir» solo pide ubicación y notificaciones.

Límites conocidos en iPhone, para medir en el piloto:

- **Alarma con el teléfono bloqueado:** suena una vez (28 s) y respeta el
  interruptor de silencio y los modos de Concentración. La alarma en bucle
  solo suena con la app en pantalla. Para que salte el silencio hace falta
  el permiso de «avisos urgentes» (time-sensitive) de Apple.
- **Si iOS cierra la app** (memoria, o el conductor la desliza), el turno
  deja de enviar y no hay aviso fiable. Lo único que puede despertarla es
  un push de la API (Fase 3), por eso en iPhone el push no es opcional.
- **No hay detector de «volvió la red»:** la cola sale al reconectar el
  socket o en el latido de 20 s.

La app declara el modo de fondo `location`, que Apple revisa al publicar.

## Cómo probarla

### Preparar

1. La API de desarrollo corriendo en el PC (`.claude/launch.json` → `api`),
   en la misma red wifi que el teléfono.
2. **Firewall de Windows**: la primera vez hay que permitir conexiones
   entrantes al puerto 3000 (Node.js) en redes privadas, o el teléfono no
   llega.
3. En el teléfono, abrir `http://<IP del PC>:3000/v1/auth/me` en el
   navegador. Si responde (aunque sea un error 401), hay conexión.

### En la app

1. Entrar con la dirección `http://<IP del PC>:3000`, un código del seed
   (101–105) y su PIN.
2. Completar la lista **Antes del turno**: ubicación, notificaciones, ofertas
   a pantalla completa y sin límite de batería. En Xiaomi, Huawei y Oppo
   además hay que activar el **inicio automático** en los ajustes de la app.
3. Abrir turno con la placa del conductor (101 → `UBP472`).

### Las pruebas que importan

| # | Prueba | Cómo | Pasa si |
| --- | --- | --- | --- |
| 1 | Alerta con teléfono bloqueado | "Probar la alerta de oferta", bloquear el teléfono y esperar 10 s | La pantalla se enciende sola con la oferta y suena la alarma |
| 2 | GPS con pantalla apagada | Turno abierto, teléfono bloqueado 15 min, caminando o en el carro | En el panel el taxi se mueve. En Diagnóstico, "con pantalla apagada" crece y el mayor hueco queda en menos de 30 s |
| 3 | Oferta real | Crear una carrera desde el panel con el teléfono bloqueado | Llega la pantalla completa. Al aceptar, el panel la marca asignada |
| 4 | Carrera completa | Llegué → A bordo → Finalizar desde la app | El panel ve cada etapa |
| 5 | Turno largo | Turno de 4 h o más con uso normal del teléfono | No hay "Android detuvo el servicio" en los eventos. Anotar el % de batería gastado |
| 6 | Otra app encima | Con el turno abierto, usar WhatsApp o Waze y recibir una oferta | Aparece como aviso flotante con Aceptar y Rechazar, y suena |

Al final de cada prueba, **"Copiar"** en Diagnóstico deja un resumen con
marca, modelo, versión de Android y los eventos, listo para pegar en el
informe.

**Ojo con la prueba 3:** el despacho ofrece primero a los taxis cercanos a la
recogida. Si el teléfono no está cerca del punto de la carrera, la oferta
llega en la ronda final, a todos los disponibles, unos minutos después.
