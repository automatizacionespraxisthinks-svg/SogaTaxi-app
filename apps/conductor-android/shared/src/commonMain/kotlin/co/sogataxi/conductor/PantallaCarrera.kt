package co.sogataxi.conductor

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * El color de cada estado vivo, el mismo de las columnas del panel
 * (`BANDA_DE_ESTADO`): negro en camino, rojo en el lugar, verde en curso.
 */
private fun colorDe(estado: EstadoCarrera): Color = when (estado) {
    EstadoCarrera.ASSIGNED -> Marca.tinta
    EstadoCarrera.DRIVER_ARRIVED -> Marca.rojoRelleno
    EstadoCarrera.IN_PROGRESS -> Marca.verde
}

private fun tituloDe(estado: EstadoCarrera): String = when (estado) {
    EstadoCarrera.ASSIGNED -> "En camino a recoger"
    EstadoCarrera.DRIVER_ARRIVED -> "En el lugar"
    EstadoCarrera.IN_PROGRESS -> "En curso"
}

/** Los motivos de `MOTIVOS_CANCELACION_CONDUCTOR` (packages/shared/src/domain/cancelacion.ts). */
private val MOTIVOS = listOf(
    "falla_mecanica" to "Falla mecánica o pinchazo",
    "accidente" to "Accidente o problema en la vía",
    "emergencia" to "Emergencia personal o de salud",
    "cliente_no_aparece" to "El cliente no aparece o no contesta",
    "otro" to "Otro motivo",
)

@Composable
fun PantallaCarrera(sesion: EstadoSesion) {
    val carrera = sesion.carrera ?: return
    val estado = sesion.estadoCarrera
    var cancelando by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        // La banda: el estado se reconoce por el color antes de leerlo.
        Row(
            Modifier.fillMaxWidth().background(colorDe(estado)).padding(horizontal = 20.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(tituloDe(estado), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(carrera.codigo, color = Color.White.copy(alpha = 0.85f), fontSize = 14.sp)
        }

        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Recoger: la dirección en grande, como la dijo el cliente.
            Column {
                Text(
                    if (estado == EstadoCarrera.IN_PROGRESS) "Recogido en" else "Recoger en",
                    color = Marca.apagado, fontSize = 14.sp,
                )
                Text(carrera.recogida, color = Marca.tinta, fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 30.sp)
                carrera.referencia?.let { Text(it, color = Marca.tinta.copy(alpha = 0.8f), fontSize = 18.sp) }
                if (!carrera.tienePunto && estado != EstadoCarrera.IN_PROGRESS) {
                    Text(
                        "Sin ubicación exacta: el mapa busca la dirección escrita. Llama al cliente si no la encuentras.",
                        color = Marca.naranja, fontSize = 14.sp,
                    )
                }
            }

            if (estado == EstadoCarrera.ASSIGNED && carrera.tienePunto) {
                sesion.metrosALaRecogida?.let { metros ->
                    val texto = if (metros <= sesion.radioLlegada) "Estás en el lugar" else if (metros < 1000) "A $metros m" else "A ${unDecimal(metros / 1000.0)} km"
                    Text(texto, color = Marca.tinta, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            }

            if (estado != EstadoCarrera.IN_PROGRESS) {
                Mapas.enlaces(carrera)?.let { enlaces ->
                    BotonDeMapa("Ir con Maps", Color.White, Color(0xFF202124)) { plataforma.abrirEnlace(enlaces.maps) }
                    BotonDeMapa("Ir con Waze", Color(0xFF33CCFF), Color(0xFF0B1B26)) { plataforma.abrirEnlace(enlaces.waze) }
                }
            }

            Tarjeta {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(carrera.cliente ?: "Cliente", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Marca.tinta)
                        Text(
                            "${carrera.pasajeros} pasajero${if (carrera.pasajeros == 1) "" else "s"}",
                            color = Marca.apagado, fontSize = 15.sp,
                        )
                    }
                    carrera.telefono?.let { tel ->
                        Button(
                            onClick = { plataforma.llamar(tel) },
                            colors = ButtonDefaults.buttonColors(containerColor = Marca.verdeRelleno, contentColor = Color.White),
                            modifier = Modifier.height(52.dp),
                        ) { Text("Llamar", fontWeight = FontWeight.Bold, fontSize = 17.sp) }
                    }
                }
                Spacer(Modifier.height(10.dp))
                // El medio de pago, para no llevarse la sorpresa al cobrar.
                Text(
                    "Paga con " + textoDelPago(carrera.pagoElectronico, carrera.medioPago),
                    color = if (carrera.pagoElectronico) Marca.tinta else Marca.apagado,
                    fontWeight = if (carrera.pagoElectronico) FontWeight.Bold else FontWeight.Normal,
                    fontSize = 16.sp,
                    modifier = Modifier
                        .background(if (carrera.pagoElectronico) Color(0xFFFFF7D1) else Color(0xFFF7F6F2), RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                )
                // Mascota, licorera o cables: que lo sepa antes de llegar.
                textoDelServicio(carrera.servicio)?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Servicio: $it",
                        color = Marca.tinta,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        modifier = Modifier
                            .background(Color(0xFFFDEFDC), RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
                carrera.notas?.let {
                    Spacer(Modifier.height(10.dp))
                    Text("Notas", color = Marca.apagado, fontSize = 13.sp)
                    Text(it, color = Marca.tinta, fontSize = 16.sp)
                }
            }

            carrera.fotoEn?.let { FotoDelLugar(carrera.rideId, it) }

            if (estado != EstadoCarrera.IN_PROGRESS) {
                TextButton(onClick = { cancelando = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("No puedo hacer esta carrera", color = Marca.rojo, fontSize = 16.sp)
                }
            }
        }

        // El botón de la etapa, abajo y grande: es lo único que se toca con prisa.
        Column(Modifier.background(Marca.superficie).navigationBarsPadding().padding(16.dp)) {
            BotonDeEtapa(sesion, carrera)
        }
    }

    if (cancelando) {
        DialogoCancelar(carrera.codigo, yaLlego = estado == EstadoCarrera.DRIVER_ARRIVED, alCerrar = { cancelando = false })
    }
}

@Composable
private fun BotonDeMapa(texto: String, fondo: Color, letra: Color, alPulsar: () -> Unit) {
    Button(
        onClick = alPulsar,
        modifier = Modifier.fillMaxWidth().height(56.dp).border(1.dp, Color(0xFFDADCE0), RoundedCornerShape(28.dp)),
        colors = ButtonDefaults.buttonColors(containerColor = fondo, contentColor = letra),
    ) { Text(texto, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
}

/**
 * Llegué → Pasajero a bordo → Finalizar. "Finalizar" queda bloqueado con una
 * cuenta atrás hasta cumplir el mínimo a bordo que dice la API; el servidor
 * lo rechazaría igual (`RIDE_TOO_SHORT`).
 */
@Composable
private fun BotonDeEtapa(sesion: EstadoSesion, carrera: Carrera) {
    val estado = sesion.estadoCarrera
    val siguiente = when (estado) {
        EstadoCarrera.ASSIGNED -> Etapa.LLEGUE
        EstadoCarrera.DRIVER_ARRIVED -> Etapa.A_BORDO
        EstadoCarrera.IN_PROGRESS -> Etapa.FINALIZAR
    }
    val color = when (siguiente) {
        Etapa.LLEGUE -> Marca.tinta
        Etapa.A_BORDO -> Marca.rojoRelleno
        Etapa.FINALIZAR -> Marca.verde
    }

    var ahora by remember { mutableLongStateOf(ahoraMs()) }
    LaunchedEffect(estado) {
        while (estado == EstadoCarrera.IN_PROGRESS) {
            ahora = ahoraMs()
            delay(1_000)
        }
    }
    val minimoMs = (sesion.minutosMinimos ?: 0) * 60_000L
    val faltaMs = if (estado == EstadoCarrera.IN_PROGRESS && carrera.abordoDesde != null) {
        (carrera.abordoDesde + minimoMs - ahora).coerceAtLeast(0)
    } else 0L

    if (faltaMs > 0) {
        val s = faltaMs / 1000
        Text(
            "Una carrera dura al menos ${sesion.minutosMinimos} minutos desde que sube el pasajero.",
            color = Marca.apagado, fontSize = 14.sp,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = {},
            enabled = false,
            modifier = Modifier.fillMaxWidth().height(72.dp),
        ) { Text("Finalizar en ${s / 60}:${dosDigitos(s % 60)}", fontSize = 22.sp, fontWeight = FontWeight.Bold) }
    } else {
        // El botón cambia de etapa en el mismo sitio: un doble toque en un
        // bache marcaba «Llegué» y «Pasajero a bordo» a la vez.
        var listo by remember(siguiente) { mutableStateOf(false) }
        LaunchedEffect(siguiente) {
            delay(1_200)
            listo = true
        }
        Button(
            onClick = { if (listo) Sesion.etapa(siguiente) },
            enabled = listo,
            modifier = Modifier.fillMaxWidth().height(72.dp),
            colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White),
        ) { Text(siguiente.nombre, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
    }
}

/** La foto que mandó el cliente del lugar; tocarla la abre en grande. */
@Composable
private fun FotoDelLugar(rideId: String, version: String) {
    var imagen by remember(rideId, version) { mutableStateOf<ImageBitmap?>(null) }
    var grande by remember { mutableStateOf(false) }
    LaunchedEffect(rideId, version) {
        imagen = runCatching {
            val bytes = Api.bytes("/v1/driver/rides/$rideId/photo")
            withContext(Dispatchers.Default) { decodificarImagen(bytes) }
        }.getOrNull()
    }
    val foto = imagen ?: return
    Tarjeta {
        Text("Foto que envió el cliente", color = Marca.apagado, fontSize = 14.sp)
        Spacer(Modifier.height(8.dp))
        Image(
            bitmap = foto,
            contentDescription = "Foto del lugar de recogida",
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp).clickable { grande = true },
        )
    }
    if (grande) {
        Dialog(onDismissRequest = { grande = false }) {
            Box(Modifier.fillMaxWidth().background(Color.Black).clickable { grande = false }) {
                Image(foto, "Foto del lugar de recogida", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** Cancelar por causa mayor: motivo de la lista, y con "Otro", explicarlo. */
@Composable
private fun DialogoCancelar(codigo: String, yaLlego: Boolean, alCerrar: () -> Unit) {
    val escena = rememberCoroutineScope()
    var motivo by remember { mutableStateOf<String?>(null) }
    var detalle by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    val listo = motivo != null && (motivo != "otro" || detalle.trim().length >= 5)

    AlertDialog(
        onDismissRequest = { if (!enviando) alCerrar() },
        title = { Text("Cancelar la carrera $codigo", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("La carrera vuelve a buscar otro taxi. Queda registrado el motivo.", color = Marca.apagado)
                Text(
                    "Cancelar una carrera ya aceptada sin una causa mayor lo suspende 30 minutos. También la segunda cancelación del día.",
                    color = Marca.tinta,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    modifier = Modifier.fillMaxWidth().background(Color(0xFFFDEFDC), RoundedCornerShape(8.dp)).padding(10.dp),
                )
                // «El cliente no aparece» solo vale con el taxi ya en el punto.
                MOTIVOS.filter { yaLlego || it.first != "cliente_no_aparece" }.forEach { (clave, texto) ->
                    val elegido = motivo == clave
                    Text(
                        texto,
                        fontSize = 16.sp,
                        fontWeight = if (elegido) FontWeight.Bold else FontWeight.Normal,
                        color = Marca.tinta,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(if (elegido) Color(0xFFFDE8E2) else Color.Transparent, RoundedCornerShape(8.dp))
                            .border(1.dp, if (elegido) Marca.rojoRelleno else Color(0xFFDDDBD2), RoundedCornerShape(8.dp))
                            .clickable { motivo = clave }
                            .padding(12.dp),
                    )
                }
                if (motivo == "otro") {
                    OutlinedTextField(
                        value = detalle, onValueChange = { detalle = it.take(200) },
                        label = { Text("¿Qué pasó?") }, modifier = Modifier.fillMaxWidth(),
                    )
                }
                error?.let { Text(it, color = Marca.rojo) }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    enviando = true
                    error = null
                    escena.launch {
                        error = Sesion.cancelar(motivo!!, detalle)
                        enviando = false
                        if (error == null) alCerrar()
                    }
                },
                enabled = listo && !enviando,
                colors = ButtonDefaults.buttonColors(containerColor = Marca.rojoRelleno, contentColor = Color.White),
            ) { Text(if (enviando) "Enviando…" else "Cancelar carrera", fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            TextButton(onClick = alCerrar, enabled = !enviando) { Text("Volver", color = Marca.tinta) }
        },
    )
}
