plugins {
    id("com.android.application") version "8.7.3" apply false
    id("com.android.library") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("org.jetbrains.kotlin.multiplatform") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0" apply false
    id("org.jetbrains.compose") version "1.7.3" apply false
}

// Compilar fuera de la carpeta del proyecto cuando está en OneDrive o
// Dropbox: el cliente de sincronización bloquea los .dex mientras Gradle los
// escribe y la compilación falla con «el archivo está siendo utilizado».
//   $env:SOGATAXI_BUILD_DIR = "$env:LOCALAPPDATA\sogataxi-build"
System.getenv("SOGATAXI_BUILD_DIR")?.takeIf { it.isNotBlank() }?.let { base ->
    allprojects { layout.buildDirectory.set(file("$base/${project.name}")) }
}
