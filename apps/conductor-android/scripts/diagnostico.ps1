# Espera el teléfono, captura la pantalla sin tocar la app y vuelca el
# registro de la app y lo que guarda (cola, último estado) a capturas\.
#   powershell -ExecutionPolicy Bypass -File scripts\diagnostico.ps1 -Nombre 05-diagnostico
param([string]$Nombre = 'diagnostico')
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$paquete = 'co.sogataxi.conductor.fase0'
$destino = Join-Path $PSScriptRoot '..\capturas'
New-Item -ItemType Directory -Force -Path $destino | Out-Null

& $adb wait-for-device
& (Join-Path $PSScriptRoot 'captura.ps1') -Nombre $Nombre

# Las preferencias de la app (cola de etapas, último estado). La app es de
# depuración, así que run-as puede leer su carpeta privada.
& $adb exec-out run-as $paquete cat shared_prefs/sogataxi.xml > (Join-Path $destino "$Nombre-prefs.xml")

# El registro de la app: solo su proceso.
$proceso = (& $adb shell pidof $paquete).Trim()
if ($proceso) {
    & $adb logcat -d -v time --pid=$proceso > (Join-Path $destino "$Nombre-logcat.txt")
} else {
    Write-Host 'La app no está corriendo.'
}
Write-Host "DIAGNOSTICO-LISTO $Nombre"
