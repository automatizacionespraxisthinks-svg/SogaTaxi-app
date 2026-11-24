# Instala el Android SDK mínimo para compilar la app de conductores, sin
# Android Studio: las command-line tools de Google, verificadas con el SHA-1
# que publica Google en su repositorio, en %LOCALAPPDATA%\Android\Sdk.
#
# Después pide aceptar las licencias (las tienes que leer y aceptar tú) e
# instala la plataforma Android 15, las build-tools y platform-tools (adb).
#
#   powershell -ExecutionPolicy Bypass -File apps\conductor-android\scripts\instalar-sdk.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest va 10 veces más rápido sin barra

$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$herramientas = Join-Path $sdk 'cmdline-tools\latest'
$sdkmanager = Join-Path $herramientas 'bin\sdkmanager.bat'

# commandlinetools-win-16111833 (cmdline-tools 23.0), tomado de
# https://dl.google.com/android/repository/repository2-3.xml el 24/11/2026.
$url = 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip'
$sha1 = '57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d'

if (-not (Test-Path $sdkmanager)) {
    New-Item -ItemType Directory -Force -Path $sdk | Out-Null
    $zip = Join-Path $env:TEMP 'commandlinetools-win.zip'
    Write-Host "Descargando las command-line tools de Google (155 MB)..."
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    $hallado = (Get-FileHash -Path $zip -Algorithm SHA1).Hash.ToLower()
    if ($hallado -ne $sha1) {
        Remove-Item $zip -Force
        throw "El SHA-1 no coincide ($hallado). No se instala nada."
    }
    Write-Host "SHA-1 verificado."

    $temporal = Join-Path $env:TEMP 'cmdline-tools-extraido'
    if (Test-Path $temporal) { Remove-Item $temporal -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $temporal
    New-Item -ItemType Directory -Force -Path (Join-Path $sdk 'cmdline-tools') | Out-Null
    if (Test-Path $herramientas) { Remove-Item $herramientas -Recurse -Force }
    Move-Item (Join-Path $temporal 'cmdline-tools') $herramientas
    Remove-Item $zip, $temporal -Recurse -Force
    Write-Host "Command-line tools en $herramientas"
} else {
    Write-Host "Las command-line tools ya están en $herramientas"
}

# Desde cmdline-tools 23, `sdkmanager` está obsoleto y delega en el nuevo
# Android CLI (`android sdk ...`): los paquetes se nombran con "/" en vez de
# ";", y ya no hay un paso `--licenses` aparte (usar la herramienta acepta los
# términos de https://developer.android.com/studio/terms).
# --no-metrics: sin enviar a Google datos de uso de la herramienta.
$android = Join-Path $herramientas 'bin\android.exe'

Write-Host ""
Write-Host "Instalando Android 15 (plataforma 35), build-tools y platform-tools (~600 MB)..."
& $android --no-metrics sdk install 'platforms/android-35' 'build-tools/35.0.0' 'platform-tools'

Write-Host ""
Write-Host "Listo. SDK en $sdk"
