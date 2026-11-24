# Túnel por el cable USB: el localhost:3000 del teléfono llega a la API del
# PC sin pasar por el wifi ni el firewall. En la app, dirección de la API:
# http://localhost:3000
#
# Solo para pruebas funcionales: con el cable puesto el teléfono carga y
# Android no entra en reposo (Doze), que es justo lo que la prueba de GPS con
# pantalla bloqueada tiene que medir. Esa va por wifi y sin cable.
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb reverse tcp:3000 tcp:3000
& $adb reverse --list
Write-Host "Desde el teléfono a http://localhost:3000/v1/auth/me (401 = hay conexión):"
& $adb shell "curl -s -m 8 -o /dev/null -w '%{http_code}\n' http://localhost:3000/v1/auth/me || echo 'sin respuesta'"
