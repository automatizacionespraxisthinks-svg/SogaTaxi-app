package co.sogataxi.conductor

import android.Manifest
import android.app.Activity
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/** Ubicación «mientras se usa la app» y, desde Android 13, las notificaciones. */
fun permisosDeTurno(): Array<String> = buildList {
    add(Manifest.permission.ACCESS_FINE_LOCATION)
    add(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()

@Composable
actual fun rememberPedirPermisos(alTerminar: () -> Unit): () -> Unit {
    val contexto = LocalContext.current
    val lanzador = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { dados ->
        /*
         * Tras dos negativas Android ya no muestra el diálogo y el resultado
         * vuelve al instante sin la ubicación: el botón parecía no hacer nada.
         * Ahí la única salida son los ajustes de la app.
         */
        val actividad = contexto as? Activity
        val fina = Manifest.permission.ACCESS_FINE_LOCATION
        val sinUbicacion = dados[fina] != true &&
            ContextCompat.checkSelfPermission(contexto, fina) != PackageManager.PERMISSION_GRANTED
        if (sinUbicacion && actividad != null && !ActivityCompat.shouldShowRequestPermissionRationale(actividad, fina)) {
            runCatching {
                contexto.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${contexto.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                Toast.makeText(contexto, "Toca Permisos › Ubicación › «Permitir mientras se usa la app» y activa «Ubicación precisa».", Toast.LENGTH_LONG).show()
            }
        }
        alTerminar()
    }
    return { lanzador.launch(permisosDeTurno()) }
}

actual fun decodificarImagen(bytes: ByteArray): ImageBitmap? =
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
