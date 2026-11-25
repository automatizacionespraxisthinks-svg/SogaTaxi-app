package co.sogataxi.conductor

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.window.ComposeUIViewController
import org.jetbrains.skia.Image
import platform.UIKit.UIViewController

/*
 * Lo que la app de iPhone (`iosApp/`, en Swift) llama del código común.
 * Desde Swift estas funciones se ven como `ArranqueKt.iniciarConductor(...)`.
 */

/** Una vez, al arrancar la app, antes de pintar nada. */
fun iniciarConductor(puente: PuenteIos, apiBase: String, apiEditable: Boolean, depuracion: Boolean) {
    TurnoIos.puente = puente
    plataforma = PlataformaIos(puente, apiBase.trim().trimEnd('/'), apiEditable, depuracion)
    Sesion.iniciar()
}

/** La app entera, la misma de Android, lista para ponerla en la ventana. */
fun vistaPrincipal(): UIViewController = ComposeUIViewController { AppConductor(ofertaIntegrada = true) }

/** Desde `applicationWillTerminate`. */
fun alCerrarLaApp() = TurnoIos.alCerrarLaApp()

@Composable
actual fun rememberPedirPermisos(alTerminar: () -> Unit): () -> Unit =
    remember(alTerminar) { { (plataforma as PlataformaIos).pedirPermisos(alTerminar) } }

actual fun decodificarImagen(bytes: ByteArray): ImageBitmap? =
    runCatching { Image.makeFromEncoded(bytes).toComposeImageBitmap() }.getOrNull()
