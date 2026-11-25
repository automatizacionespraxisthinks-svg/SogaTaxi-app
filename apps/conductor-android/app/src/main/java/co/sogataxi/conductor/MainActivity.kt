package co.sogataxi.conductor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent

/**
 * La única pantalla de Android: pinta la app común (`AppConductor`, en
 * `shared`). Las pantallas, la sesión y el turno son los mismos del iPhone.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // La oferta también dentro de la app: con el teléfono desbloqueado y
        // la app en pantalla, Android no abre OfertaActivity (solo un aviso
        // flotante, que MIUI y ColorOS apagan en apps instaladas por APK), y
        // sin permiso de notificaciones no se veía nada mientras sonaba.
        setContent { AppConductor(ofertaIntegrada = true) }
    }
}
