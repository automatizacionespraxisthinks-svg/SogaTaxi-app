plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "co.sogataxi.conductor"
    compileSdk = 35

    defaultConfig {
        applicationId = "co.sogataxi.conductor"
        // Android 8.0: cubre prácticamente todos los celulares de la flota y
        // es el mínimo de los canales de notificación.
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0-fase2"
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
            isMinifyEnabled = false
            // PENDIENTE: el dominio de producción de la API de SogaTaxi. Solo
            // HTTPS: la versión final no permite tráfico en texto plano.
            buildConfigField("String", "API_BASE", "\"https://api.sogataxi.example\"")
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
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    // Ubicación de Google Play Services: la que mejor sostiene el GPS con la
    // pantalla apagada y combina GPS, wifi y celdas.
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // El mismo socket que usa la PWA (namespace /rt de socket.io 4).
    implementation("io.socket:socket.io-client:2.1.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
