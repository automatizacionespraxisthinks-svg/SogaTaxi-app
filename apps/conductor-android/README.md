# SogaTaxi Conductor — app Android nativa (fase 0)

Prueba de concepto para decidir la migración de la PWA de conductores a una
app nativa. **No reemplaza todavía a la PWA**: solo comprueba en teléfonos
reales lo que la PWA no puede hacer.

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

## Qué queda fuera de la fase 0

- **FCM.** Hace falta el proyecto de Firebase de SogaTaxi. Por ahora las
  ofertas solo llegan con el turno abierto, que es justo cuando se ofrecen.
  FCM será el respaldo para cuando Android mate el proceso.
- La cola de etapas sin señal, la foto del cliente, el botón de Ir con
  Maps/Waze, cambiar de carro y cancelar la carrera: todo eso es de la fase 2.
- **Seguridad de producción.** Esta versión permite HTTP en texto plano para
  hablar con la API de la red local (`network_security_config.xml`) y guarda
  el token sin cifrar.

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
