package co.sogataxi.conductor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * La app entera, igual en Android y en iPhone.
 *
 * `ofertaIntegrada`: la oferta se pinta aquí mismo, encima de todo. En
 * Android no hace falta, porque la oferta tiene su propia pantalla que se
 * pone sobre el bloqueo (`OfertaActivity`); en iPhone no existe eso, y la
 * oferta se ve al abrir la app desde el aviso.
 */
@Composable
fun AppConductor(ofertaIntegrada: Boolean = false) {
    TemaSogaTaxi {
        Box(Modifier.fillMaxSize()) {
            Raiz()
            if (ofertaIntegrada) {
                val oferta by Ofertas.flujo.collectAsState()
                oferta?.let { actual ->
                    Box(Modifier.fillMaxSize().background(Marca.tinta).safeDrawingPadding()) {
                        PantallaOferta(
                            oferta = actual,
                            alAceptar = {
                                Ofertas.aceptar(actual.rideId) { error ->
                                    if (error != null) plataforma.mensajeBreve(error)
                                }
                            },
                            alRechazar = { Ofertas.rechazar(actual.rideId) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Raiz() {
    val escena = rememberCoroutineScope()
    val sesion by Sesion.flujo.collectAsState()
    val diag by Diagnostico.flujo.collectAsState()
    val versionNueva by Actualizacion.flujo.collectAsState()

    // Al volver a la app: el estado real de la API, y el turno alineado con
    // él. Si el turno está abierto pero el sistema lo mató, se vuelve a
    // iniciar desde aquí, que es primer plano.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        Avisos.quitar()
        escena.launch {
            Sesion.refrescar()
            alinearTurno(Sesion.flujo.value.fase, Diagnostico.flujo.value.turnoDesde != null)
            Actualizacion.revisar()
        }
    }

    Column(Modifier.fillMaxSize().background(Marca.fondo)) {
        Cabecera(sesion, diag.turnoDesde != null)
        AvisoDeConexion(sesion)
        // En carrera no: el conductor no va a actualizar con un cliente a bordo.
        versionNueva?.takeIf { sesion.fase != Fase.CARRERA }?.let { AvisoDeVersion(it) }
        when (sesion.fase) {
            Fase.ACCESO -> PantallaAcceso(sesion)
            Fase.FUERA_DE_TURNO -> PantallaFueraDeTurno(sesion, alAbrir = {
                alinearTurno(Fase.DISPONIBLE, false)
            })
            Fase.DISPONIBLE, Fase.PAUSA -> PantallaEnTurno(sesion, alCerrar = {
                plataforma.detenerTurno()
            })
            Fase.CARRERA -> PantallaCarrera(sesion)
            Fase.RESUMEN -> PantallaResumen(sesion)
        }
    }
}

/** El turno corre en el teléfono si y solo si hay turno abierto en la oficina. */
private fun alinearTurno(fase: Fase, corriendo: Boolean) {
    val enTurno = fase == Fase.DISPONIBLE || fase == Fase.PAUSA || fase == Fase.CARRERA || fase == Fase.RESUMEN
    if (enTurno && !corriendo && plataforma.tienePermisoDeUbicacion()) plataforma.iniciarTurno()
    if (!enTurno && corriendo) plataforma.detenerTurno()
}

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

/** Hay una versión más nueva: una franja con el botón que abre la descarga. */
@Composable
private fun AvisoDeVersion(version: VersionNueva) {
    Row(
        Modifier.fillMaxWidth().background(if (version.obligatoria) Color(0xFFFDE8E2) else Color(0xFFE6F4EA)).padding(start = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            buildString {
                append(if (version.obligatoria) "Tienes que actualizar la app para abrir turno" else "Hay una versión nueva de la app")
                version.nombre?.let { append(" ($it)") }
                append(".")
            },
            color = Marca.tinta, fontSize = 14.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f).padding(vertical = 10.dp),
        )
        TextButton(onClick = { plataforma.abrirEnlace(version.enlace) }) {
            Text("Actualizar", color = Marca.tinta, fontWeight = FontWeight.Bold)
        }
    }
}

/* ------------------------------------------------------------------ oferta */

/** La oferta a pantalla completa, como una llamada entrante. */
@Composable
fun PantallaOferta(oferta: OfertaDeCarrera, alAceptar: () -> Unit, alRechazar: () -> Unit) {
    val restante = remember { mutableLongStateOf(0L) }
    LaunchedEffect(oferta.rideId) {
        while (true) {
            restante.longValue = ((oferta.venceEn - ahoraMs()) / 1000).coerceAtLeast(0)
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
                "${oferta.etaMin} min · ${unDecimal(oferta.distanciaKm)} km",
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
