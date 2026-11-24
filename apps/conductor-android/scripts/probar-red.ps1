# Comprueba, desde el teléfono conectado por USB, si llega a la API del PC
# por la red wifi. Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\probar-red.ps1 -Ip 192.168.1.3
param([string]$Ip = '192.168.1.3', [int]$Puerto = 3000)

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'

Write-Host "Wifi del teléfono:"
& $adb shell "ip -4 addr show wlan0 | grep inet"

Write-Host ""
Write-Host "Desde el teléfono a http://${Ip}:${Puerto}/v1/auth/me (401 = hay conexión):"
& $adb shell "curl -s -m 8 -o /dev/null -w '%{http_code}\n' http://${Ip}:${Puerto}/v1/auth/me || echo 'sin respuesta (firewall de Windows o red distinta)'"
