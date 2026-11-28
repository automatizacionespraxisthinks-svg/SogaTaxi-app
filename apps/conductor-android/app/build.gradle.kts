import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * La firma de la versión final sale de `keystore.properties`, que NO va en
 * git (ver README, «Firmar la versión final»). Sin ese archivo el proyecto
 * compila igual y la versión final queda sin firmar.
 */
val firma = Properties().apply {
    val archivo = rootProject.file("keystore.properties")
    if (archivo.exists()) archivo.inputStream().use { load(it) }
}
val hayFirma = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    .all { !firma.getProperty(it).isNullOrBlank() }

android {
    namespace = "co.sogataxi.conductor"

    signingConfigs {
        if (hayFirma) {
            create("release") {
                storeFile = rootProject.file(firma.getProperty("storeFile"))
                storePassword = firma.getProperty("storePassword")
                keyAlias = firma.getProperty("keyAlias")
                keyPassword = firma.getProperty("keyPassword")
            }
        }
    }
    compileSdk = 35

    defaultConfig {
        applicationId = "co.sogataxi.conductor"
        // Android 8.0: cubre prácticamente todos los celulares de la flota y
        // es el mínimo de los canales de notificación.
        minSdk = 26
        targetSdk = 35
        // Sube en cada APK que se entrega: es el número que la app compara
        // con el de la API (APP_ANDROID_VERSION_CODE) para avisar que hay
        // una versión nueva.
        versionCode = 7
        versionName = "0.5.0"
    }

    buildTypes {
        debug {
            // Se conserva el de la fase 0 para que el APK de prueba ya
            // instalado se actualice en su lugar y no quede una segunda app.
            applicationIdSuffix = ".fase0"
            // La API de desarrollo en la red local; se puede cambiar en el acceso.
            buildConfigField("String", "API_BASE", "\"http://192.168.1.3:3000\"")
            buildConfigField("boolean", "API_EDITABLE", "true")
        }
        release {
            if (hayFirma) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            // El dominio de producción de la API de SogaTaxi (25/11/2026). Solo
            // HTTPS: la versión final no permite tráfico en texto plano.
            buildConfigField("String", "API_BASE", "\"https://api.sogataxi.praxisia.org\"")
            buildConfigField("boolean", "API_EDITABLE", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    // El código común: sesión, cola, API, motor del turno y las pantallas.
    implementation(project(":shared"))

    implementation("androidx.core:core-ktx:1.15.0")

    // Ubicación de Google Play Services: la que mejor sostiene el GPS con la
    // pantalla apagada y combina GPS, wifi y celdas.
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // El mismo socket que usa la PWA (namespace /rt de socket.io 4).
    implementation("io.socket:socket.io-client:2.1.1")
}
