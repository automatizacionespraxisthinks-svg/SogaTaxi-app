package co.sogataxi.conductor

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

/**
 * La oferta a pantalla completa: se enciende sola y queda encima del
 * bloqueo, como una llamada entrante. Lo que se ve dentro es la pantalla
 * común (`PantallaOferta`).
 */
class OfertaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        atender(intent)

        setContent {
            TemaSogaTaxi {
                val oferta by Ofertas.flujo.collectAsState()
                val actual = oferta
                if (actual == null) {
                    LaunchedEffect(Unit) { finish() }
                } else {
                    PantallaOferta(
                        oferta = actual,
                        alAceptar = { aceptar(actual.rideId) },
                        alRechazar = {
                            Ofertas.rechazar(actual.rideId)
                            finish()
                        },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        atender(intent)
    }

    /** El botón ACEPTAR de la notificación llega aquí con la acción ACEPTAR. */
    private fun atender(intent: Intent?) {
        if (intent?.action == ACEPTAR) intent.getStringExtra("rideId")?.let { aceptar(it) }
    }

    private fun aceptar(rideId: String) {
        Ofertas.aceptar(rideId) { error ->
            if (error != null) Toast.makeText(this, error, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }
    }

    companion object {
        const val ACEPTAR = "co.sogataxi.conductor.oferta.ACEPTAR"
    }
}
