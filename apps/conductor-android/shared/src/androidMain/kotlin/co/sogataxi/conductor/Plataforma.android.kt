package co.sogataxi.conductor

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.graphics.BitmapFactory
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/**
 * Primer paso: ubicación precisa y, desde Android 13, las notificaciones.
 * «Todo el tiempo» va aparte (segundo paso): Android 11+ no deja pedirlo en el
 * mismo diálogo, y desde el 10 solo se concede si ya está la de primer plano.
 */
fun permisosDeTurno(): Array<String> = buildList {
    add(Manifest.permission.ACCESS_FINE_LOCATION)
    add(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()

private fun concedido(contexto: Context, permiso: String) =
    ContextCompat.checkSelfPermission(contexto, permiso) == PackageManager.PERMISSION_GRANTED

/** Tras dos negativas Android ya no muestra el diálogo: solo quedan los ajustes de la app. */
private fun abrirAjustesDeLaApp(contexto: Context, instrucciones: String) {
    runCatching {
        contexto.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${contexto.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        Toast.makeText(contexto, instrucciones, Toast.LENGTH_LONG).show()
    }
}

private const val INSTRUCCIONES =
    "Toca Permisos › Ubicación › «Permitir todo el tiempo» y activa «Ubicación precisa»."

@Composable
actual fun rememberPedirPermisos(alTerminar: () -> Unit): () -> Unit {
    val contexto = LocalContext.current
    val actividad = contexto as? Activity
    val fina = Manifest.permission.ACCESS_FINE_LOCATION
    // Cuándo se pidió «todo el tiempo»: si Android contesta al instante es que
    // no mostró nada (ya lo habían negado) y solo quedan los ajustes de la app.
    val pedidoEn = remember { longArrayOf(0L) }

    // Segundo paso. En Android 10 sale el diálogo con «Permitir todo el
    // tiempo»; en el 11 o más, Android abre directamente su pantalla de
    // ubicación de la app, donde se elige esa opción.
    val lanzadorSiempre = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { dado ->
        val sinPantalla = System.currentTimeMillis() - pedidoEn[0] < 600
        if (!dado && sinPantalla) {
            abrirAjustesDeLaApp(contexto, INSTRUCCIONES)
        }
        alTerminar()
    }

    val lanzador = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { dados ->
        val conUbicacion = dados[fina] == true || concedido(contexto, fina)
        when {
            !conUbicacion -> {
                if (actividad != null && !ActivityCompat.shouldShowRequestPermissionRationale(actividad, fina)) {
                    abrirAjustesDeLaApp(contexto, INSTRUCCIONES)
                }
                alTerminar()
            }
            Build.VERSION.SDK_INT >= 29 && !concedido(contexto, Manifest.permission.ACCESS_BACKGROUND_LOCATION) -> {
                Toast.makeText(
                    contexto,
                    "Ahora elige «Permitir todo el tiempo» para que el GPS siga con la app cerrada.",
                    Toast.LENGTH_LONG,
                ).show()
                pedidoEn[0] = System.currentTimeMillis()
                lanzadorSiempre.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
            else -> alTerminar()
        }
    }
    return { lanzador.launch(permisosDeTurno()) }
}

actual fun decodificarImagen(bytes: ByteArray): ImageBitmap? =
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
