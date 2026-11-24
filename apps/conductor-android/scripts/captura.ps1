# Captura la pantalla del teléfono conectado y la deja en capturas\<nombre>.png
param([string]$Nombre = 'pantalla')
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$destino = Join-Path $PSScriptRoot "..\capturas"
New-Item -ItemType Directory -Force -Path $destino | Out-Null
& $adb shell screencap -p /sdcard/sogataxi-captura.png
& $adb pull /sdcard/sogataxi-captura.png (Join-Path $destino "$Nombre.png") | Out-Null
& $adb shell rm /sdcard/sogataxi-captura.png
Write-Host "CAPTURA-LISTA $Nombre"
