package co.sogataxi.conductor

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { TemaSogaTaxi { Raiz() } }
    }
}

@Composable
private fun Raiz() {
    val contexto = LocalContext.current
    val escena = rememberCoroutineScope()
    val sesion by Sesion.flujo.collectAsState()
    val diag by Diagnostico.flujo.collectAsState()

    // Al volver a la app: el estado real de la API, y el servicio de turno
    // alineado con él. Si el turno está abierto pero Android mató el
    // servicio, se vuelve a iniciar desde aquí, que es primer plano.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        escena.launch {
            Sesion.refrescar()
            alinearServicio(contexto, Sesion.flujo.value.fase, Diagnostico.flujo.value.turnoDesde != null)
        }
    }

    Column(Modifier.fillMaxSize().background(Marca.fondo)) {
        Cabecera(sesion, diag.turnoDesde != null)
        AvisoDeConexion(sesion)
        when (sesion.fase) {
            Fase.ACCESO -> PantallaAcceso(sesion)
            Fase.FUERA_DE_TURNO -> PantallaFueraDeTurno(sesion, alAbrir = {
                alinearServicio(contexto, Fase.DISPONIBLE, false)
            })
            Fase.DISPONIBLE, Fase.PAUSA -> PantallaEnTurno(sesion, alCerrar = {
                TurnoService.detener(contexto)
            })
            Fase.CARRERA -> PantallaCarrera(sesion)
            Fase.RESUMEN -> PantallaResumen(sesion)
        }
    }
}

/** El servicio de turno corre si y solo si hay turno abierto. */
private fun alinearServicio(contexto: Context, fase: Fase, corriendo: Boolean) {
    val enTurno = fase == Fase.DISPONIBLE || fase == Fase.PAUSA || fase == Fase.CARRERA || fase == Fase.RESUMEN
    if (enTurno && !corriendo && tienePermisoDeUbicacion(contexto)) TurnoService.iniciar(contexto)
    if (!enTurno && corriendo) TurnoService.detener(contexto)
}

fun tienePermisoDeUbicacion(contexto: Context) =
    ContextCompat.checkSelfPermission(contexto, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED

fun permisosDeTurno(): Array<String> = buildList {
    add(Manifest.permission.ACCESS_FINE_LOCATION)
    add(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()

@Composable
private fun Cabecera(sesion: EstadoSesion, servicio: Boolean) {
    Column(Modifier.background(Marca.tinta).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text("SogaTaxi · Conductor", color = Marca.sobreTinta, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                if (sesion.fase != Fase.ACCESO && Prefs.conductor != null) {
                    Text(
                        listOfNotNull(Prefs.conductor, sesion.placa?.takeIf { servicio }).joinToString(" · "),
                        color = Marca.sobreTinta.copy(alpha = 0.7f), fontSize = 13.sp,
                    )
                }
            }
            if (servicio) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Spacer(
                        Modifier.size(8.dp).background(if (sesion.enLinea) Color(0xFF7CE0A4) else Marca.rojoRelleno, CircleShape),
                    )
                    Spacer(Modifier.size(6.dp))
                    Text(if (sesion.enLinea) "En vivo" else "Sin señal", color = Marca.sobreTinta, fontSize = 13.sp)
                }
            }
        }
        // La franja de marca: amarillo 60 %, rojo 20 %, verde 20 %.
        Row(Modifier.fillMaxWidth().height(4.dp)) {
            Spacer(Modifier.weight(3f).height(4.dp).background(Marca.amarillo))
            Spacer(Modifier.weight(1f).height(4.dp).background(Marca.rojoRelleno))
            Spacer(Modifier.weight(1f).height(4.dp).background(Marca.verdeRelleno))
        }
    }
}

/**
 * Lo que el conductor tiene que saber de la conexión: que no hay señal, que
 * hay etapas guardadas esperando, o lo que la oficina rechazó.
 */
@Composable
private fun AvisoDeConexion(sesion: EstadoSesion) {
    val texto = when {
        sesion.encoladas > 0 -> "${sesion.encoladas} etapa${if (sesion.encoladas == 1) "" else "s"} guardada${if (sesion.encoladas == 1) "" else "s"}: se envía${if (sesion.encoladas == 1) "" else "n"} al volver la señal."
        else -> null
    }
    if (texto != null) {
        Text(
            texto, color = Marca.tinta, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.fillMaxWidth().background(Color(0xFFFDEFDC)).padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
    sesion.aviso?.let { aviso ->
        Row(
            Modifier.fillMaxWidth().background(Color(0xFFFFF7D1)).padding(start = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(aviso, color = Marca.tinta, fontSize = 14.sp, modifier = Modifier.weight(1f).padding(vertical = 10.dp))
            TextButton(onClick = { Sesion.avisar(null) }) { Text("OK", color = Marca.tinta, fontWeight = FontWeight.Bold) }
        }
    }
}
