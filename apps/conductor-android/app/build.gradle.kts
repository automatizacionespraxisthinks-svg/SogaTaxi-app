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
        versionCode = 1
        versionName = "0.1.0-fase0"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".fase0"
        }
        release {
            isMinifyEnabled = false
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
