# Abre la app en el teléfono conectado, espera a que cargue y captura la
# pantalla en capturas\<nombre>.png. Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\abrir-y-capturar.ps1 -Nombre 03-carrera
param([string]$Nombre = 'pantalla', [int]$Espera = 5)
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb shell am start -n co.sogataxi.conductor.fase0/co.sogataxi.conductor.MainActivity | Out-Null
Start-Sleep -Seconds $Espera
& (Join-Path $PSScriptRoot 'captura.ps1') -Nombre $Nombre
