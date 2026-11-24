# SogaTaxi Conductor — app Android nativa

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
  (`Cifrado.kt`). La versión final solo habla HTTPS; HTTP solo existe en la
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
cd apps\conductor-android; .\gradlew.bat assembleDebug
```

El APK queda en `app\build\outputs\apk\debug\app-debug.apk`. Se instala con
`adb install -r` o copiándolo al teléfono.

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
