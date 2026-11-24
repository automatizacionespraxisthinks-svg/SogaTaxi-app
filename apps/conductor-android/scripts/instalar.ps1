# Espera a que el teléfono esté conectado Y autorizado, instala el APK de
# depuración y deja grabando el registro de la app (etiqueta SogaTaxi) en
# capturas\eventos.txt. Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\instalar.ps1
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$apk = Join-Path $PSScriptRoot '..\app\build\outputs\apk\debug\app-debug.apk'
$destino = Join-Path $PSScriptRoot '..\capturas'
New-Item -ItemType Directory -Force -Path $destino | Out-Null

Write-Host 'Esperando el teléfono autorizado (acepta "Permitir depuración USB")...'
while ($true) {
    $estado = (& $adb get-state 2>$null)
    if ($estado -eq 'device') { break }
    Start-Sleep -Seconds 2
}
& $adb install -r $apk
& $adb shell am start -n co.sogataxi.conductor.fase0/co.sogataxi.conductor.MainActivity | Out-Null
Write-Host 'INSTALADO. Grabando eventos de la app en capturas\eventos.txt (Ctrl-C para parar)'
& $adb logcat -c
& $adb logcat -v time -s SogaTaxi:I > (Join-Path $destino 'eventos.txt')
