pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "SogaTaxiConductor"
// `shared`: todo lo que comparten Android y iPhone (Kotlin Multiplatform).
// `app`: lo que solo existe en Android (servicio de turno, notificaciones).
// La app de iPhone está en `iosApp/` y se compila con Xcode en un Mac.
include(":shared")
include(":app")
