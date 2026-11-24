package co.sogataxi.conductor

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * La oferta a pantalla completa: se enciende sola y queda encima del
 * bloqueo, como una llamada entrante.
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
                            Ofertas.rechazar(this, actual.rideId)
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
        Ofertas.aceptar(this, rideId) { error ->
            if (error != null) Toast.makeText(this, error, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }
    }

    companion object {
        const val ACEPTAR = "co.sogataxi.conductor.oferta.ACEPTAR"
    }
}

@Composable
private fun PantallaOferta(oferta: OfertaDeCarrera, alAceptar: () -> Unit, alRechazar: () -> Unit) {
    val restante = remember { mutableLongStateOf(0L) }
    LaunchedEffect(oferta.rideId) {
        while (true) {
            restante.longValue = ((oferta.venceEn - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
            delay(250)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Marca.tinta)
            .padding(24.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text("Nueva carrera", color = Marca.amarillo, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(
                "${oferta.etaMin} min · ${"%.1f".format(oferta.distanciaKm)} km",
                color = Marca.sobreTinta, fontSize = 40.sp, fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(20.dp))
            Text(oferta.recogida, color = Marca.sobreTinta, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            oferta.referencia?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Marca.sobreTinta.copy(alpha = 0.75f), fontSize = 18.sp)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                buildString {
                    append("${oferta.pasajeros} pasajero${if (oferta.pasajeros == 1) "" else "s"}")
                    if (oferta.pagoElectronico) append(" · Pago electrónico")
                    append(" · ${oferta.codigo}")
                },
                color = Marca.sobreTinta.copy(alpha = 0.75f), fontSize = 16.sp,
            )
        }

        Column {
            Text(
                "Vence en ${restante.longValue} s",
                color = Marca.amarillo, fontSize = 20.sp, fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = alAceptar,
                modifier = Modifier.fillMaxWidth().height(88.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Marca.amarillo, contentColor = Marca.tinta),
            ) { Text("ACEPTAR", fontSize = 28.sp, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = alRechazar,
                modifier = Modifier.fillMaxWidth().height(56.dp),
            ) { Text("Rechazar", color = Marca.sobreTinta, fontSize = 18.sp) }
        }
    }
}
