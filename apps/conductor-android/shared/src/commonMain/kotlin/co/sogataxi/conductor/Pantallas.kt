package co.sogataxi.conductor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/* ------------------------------------------------------------------ acceso */

@Composable
fun PantallaAcceso(sesion: EstadoSesion) {
    val escena = rememberCoroutineScope()
    var api by remember { mutableStateOf(Prefs.apiBase) }
    var codigo by remember { mutableStateOf(Prefs.codigo.orEmpty()) }
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }

    Columna {
        Text("Entrar", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Marca.tinta)
        Text("SogaTaxi S.A. · aplicación de conductores", color = Marca.apagado)
        if (plataforma.apiEditable) {
            OutlinedTextField(
                value = api, onValueChange = { api = it }, label = { Text("Dirección de la API (pruebas)") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
        }
        OutlinedTextField(
            value = codigo, onValueChange = { codigo = it.trim() }, label = { Text("Código de conductor") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        OutlinedTextField(
            value = pin, onValueChange = { pin = it.filter(Char::isDigit).take(6) }, label = { Text("PIN personal") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        )
        error?.let { Text(it, color = Marca.rojo) }
        BotonGrande("Entrar", habilitado = !enviando && codigo.isNotBlank() && pin.length >= 4) {
            enviando = true
            error = null
            Prefs.apiBase = api
            escena.launch {
                error = Sesion.entrar(codigo, pin, "${plataforma.dispositivo} (app nativa)")
                enviando = false
            }
        }
        Text(
            "Este celular queda registrado en tu cuenta. Si lo pierdes, avisa a la oficina para que lo revoquen.",
            color = Marca.apagado, fontSize = 14.sp,
        )
    }
}

/* ---------------------------------------------------------- fuera de turno */

@Composable
fun PantallaFueraDeTurno(sesion: EstadoSesion, alAbrir: () -> Unit) {
    val escena = rememberCoroutineScope()
    var placa by remember { mutableStateOf(Prefs.placa.orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var refresco by remember { mutableIntStateOf(0) }
    val pedirPermisos = rememberPedirPermisos { refresco++ }
    // Una versión que ya no se entiende con la oficina no abre turno.
    val versionNueva by Actualizacion.flujo.collectAsState()
    val hayQueActualizar = versionNueva?.obligatoria == true

    Columna {
        Text("Fuera de turno", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Marca.tinta)
        Text("Abre el turno para empezar a recibir carreras.", color = Marca.apagado, fontSize = 18.sp)

        Chequeo(refresco, alPedirPermisos = pedirPermisos)

        PlacasPermitidas(elegida = placa, alElegir = { placa = it })
        OutlinedTextField(
            value = placa, onValueChange = { placa = it.uppercase().filter(Char::isLetterOrDigit).take(10) },
            label = { Text("Placa del vehículo de hoy") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = Marca.rojo) }
        if (hayQueActualizar) {
            Text("Esta versión de la app ya no sirve. Toca «Actualizar» arriba, instala la nueva y vuelve a entrar.", color = Marca.rojo)
        }
        BotonGrande("Iniciar turno", habilitado = !enviando && placa.length >= 5 && !hayQueActualizar) {
            if (!plataforma.tienePermisoDeUbicacion()) {
                error = "Primero permite la ubicación (arriba)."
                return@BotonGrande
            }
            enviando = true
            error = null
            escena.launch {
                error = Sesion.abrirTurno(placa)
                if (error == null) alAbrir()
                enviando = false
            }
        }
        Text(
            "El GPS solo se registra con el turno abierto. Al cerrarlo deja de enviarse tu posición.",
            color = Marca.apagado, fontSize = 14.sp,
        )
        CambiarConductor()
    }
}

/**
 * Los vehículos que este conductor puede manejar (`GET /v1/driver/vehicles`),
 * para tocar la placa en vez de escribirla.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlacasPermitidas(elegida: String, alElegir: (String) -> Unit) {
    var placas by remember { mutableStateOf<List<Pair<String, String?>>>(emptyList()) }
    LaunchedEffect(Unit) {
        runCatching {
            val lista = Api.get("/v1/driver/vehicles") as JsonArray
            placas = lista.mapNotNull { elemento ->
                val v = elemento as? JsonObject ?: return@mapNotNull null
                val placa = v.texto("plate") ?: return@mapNotNull null
                placa to v.texto("interno")
            }
        }
    }
    if (placas.isEmpty()) return
    Text("Tus vehículos", color = Marca.apagado, fontSize = 14.sp)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        placas.forEach { (placa, interno) ->
            val activa = placa == elegida
            Text(
                text = interno?.let { "$placa · $it" } ?: placa,
                color = Marca.tinta,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                fontSize = 18.sp,
                modifier = Modifier
                    .background(if (activa) Marca.amarillo else Marca.superficie, RoundedCornerShape(10.dp))
                    .border(2.dp, if (activa) Marca.tinta else Color(0xFFBDBAAE), RoundedCornerShape(10.dp))
                    .clickable { alElegir(placa) }
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun CambiarConductor() {
    val escena = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    error?.let { Text(it, color = Marca.rojo) }
    TextButton(onClick = { escena.launch { error = Sesion.salir() } }) {
        Text("Cambiar de conductor en este celular", color = Marca.apagado)
    }
}

/* ---------------------------------------------------------------- en turno */

@Composable
fun PantallaEnTurno(sesion: EstadoSesion, alCerrar: () -> Unit) {
    val escena = rememberCoroutineScope()
    val enPausa = sesion.fase == Fase.PAUSA
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var cambiandoCarro by remember { mutableStateOf(false) }
    var placaNueva by remember { mutableStateOf("") }
    var refresco by remember { mutableIntStateOf(0) }
    val pedirPermisos = rememberPedirPermisos { refresco++ }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { refresco++ }

    fun hacer(accion: suspend () -> String?) {
        enviando = true
        error = null
        escena.launch {
            error = accion()
            enviando = false
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
        // Con el turno abierto y esperando, el estado va sobre el amarillo de marca.
        Column(
            Modifier.fillMaxWidth().background(if (enPausa) Color(0xFFFDEFDC) else Marca.amarillo).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                if (enPausa) "En pausa" else "Esperando carrera",
                fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Marca.tinta,
            )
            Text(
                if (enPausa) "No recibirás ofertas hasta que vuelvas a estar disponible."
                else "Te avisamos con alarma aunque el teléfono esté bloqueado.",
                fontSize = 17.sp, color = Marca.tinta.copy(alpha = 0.8f),
            )
            DuracionDelTurno(sesion.turnoDesde)
        }

        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Chequeo(refresco, alPedirPermisos = pedirPermisos)

            Tarjeta {
                Dato("Carreras de hoy", "${sesion.carrerasHoy}")
                Dato("Vehículo", sesion.placa ?: "—")
            }
            error?.let { Text(it, color = Marca.rojo) }

            if (enPausa) {
                BotonGrande("Volver a estar disponible", habilitado = !enviando) { hacer { Sesion.reanudar() } }
            } else {
                BotonSecundario("Tomar una pausa", habilitado = !enviando) { hacer { Sesion.pausar() } }
            }

            if (!cambiandoCarro) {
                BotonSecundario("Cambiar de carro", habilitado = !enviando) { cambiandoCarro = true }
            } else {
                Tarjeta {
                    Text("¿A qué carro te cambias?", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Spacer(Modifier.height(8.dp))
                    PlacasPermitidas(elegida = placaNueva, alElegir = { placaNueva = it })
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { cambiandoCarro = false }) { Text("Cancelar", color = Marca.apagado) }
                        Button(
                            onClick = {
                                hacer {
                                    Sesion.cambiarCarro(placaNueva).also { if (it == null) cambiandoCarro = false }
                                }
                            },
                            enabled = placaNueva.length >= 5 && placaNueva != sesion.placa && !enviando,
                            colors = ButtonDefaults.buttonColors(containerColor = Marca.amarillo, contentColor = Marca.tinta),
                        ) { Text("Cambiar al $placaNueva", fontWeight = FontWeight.Bold) }
                    }
                }
            }

            if (plataforma.depuracion) {
                OutlinedButton(
                    onClick = {
                        plataforma.mensajeBreve("Bloquea el teléfono: la alerta llega en 10 s")
                        Ofertas.probarEn(10_000)
                    },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) { Text("Probar la alerta de oferta (en 10 s)", color = Marca.tinta) }
            }

            TextButton(
                onClick = {
                    hacer {
                        Sesion.cerrarTurno().also { if (it == null) alCerrar() }
                    }
                },
                enabled = !enviando,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Cerrar turno", color = Marca.rojo, fontSize = 17.sp, fontWeight = FontWeight.Bold) }

            PanelDiagnostico()
        }
    }
}

@Composable
private fun DuracionDelTurno(desde: Long?) {
    if (desde == null) return
    var ahora by remember { mutableStateOf(ahoraMs()) }
    LaunchedEffect(Unit) {
        while (true) {
            ahora = ahoraMs()
            delay(30_000)
        }
    }
    val minutos = ((ahora - desde) / 60_000).coerceAtLeast(0)
    Text(
        "Turno abierto · ${minutos / 60} h ${minutos % 60} min",
        fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Marca.tinta,
        modifier = Modifier.background(Marca.superficie, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/* ----------------------------------------------------------------- resumen */

@Composable
fun PantallaResumen(sesion: EstadoSesion) {
    Columna {
        Spacer(Modifier.height(24.dp))
        Text("✓", fontSize = 56.sp, color = Marca.verdeRelleno, fontWeight = FontWeight.Bold)
        Text("Carrera finalizada", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Marca.tinta)
        Text(
            if (sesion.encoladas > 0) "Se enviará a la oficina en cuanto haya señal."
            else "La oficina ya la tiene registrada.",
            color = Marca.apagado, fontSize = 17.sp,
        )
        Tarjeta { Dato("Carreras de hoy", "${sesion.carrerasHoy}") }
        BotonGrande("Volver a estar disponible") { Sesion.volverADisponible() }
    }
}

/* -------------------------------------------------------- chequeo y diagnóstico */

/**
 * Lo que tiene que estar permitido para que el turno funcione con el
 * teléfono bloqueado. Si todo está bien, no se muestra.
 */
@Composable
fun Chequeo(refresco: Int, alPedirPermisos: () -> Unit) {
    val requisitos = remember(refresco) { plataforma.requisitos() }
    if (requisitos.all { it.listo }) return

    Tarjeta {
        Text("Falta permitir", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text("Sin esto el teléfono puede dejar de enviar el GPS o no sonar con las ofertas.", color = Marca.apagado)
        Spacer(Modifier.height(6.dp))
        requisitos.forEach { FilaChequeo(it.nombre, it.listo, it.arreglar ?: alPedirPermisos) }
    }
}

@Composable
private fun FilaChequeo(texto: String, listo: Boolean, alArreglar: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text((if (listo) "✓  " else "✗  ") + texto, color = if (listo) Marca.verde else Marca.rojo, fontSize = 16.sp)
        if (!listo) TextButton(onClick = alArreglar) { Text("Permitir", color = Marca.tinta, fontWeight = FontWeight.Bold) }
    }
}

/** Para el piloto con conductores: plegado, se abre si hace falta reportar algo. */
@Composable
fun PanelDiagnostico() {
    val portapapeles = LocalClipboardManager.current
    val diag by Diagnostico.flujo.collectAsState()
    var abierto by remember { mutableStateOf(false) }
    var ahora by remember { mutableStateOf(ahoraMs()) }
    LaunchedEffect(abierto) {
        while (abierto) {
            ahora = ahoraMs()
            delay(1_000)
        }
    }
    fun hace(t: Long?) = t?.let { "hace ${(ahora - it) / 1000} s" } ?: "—"

    Tarjeta {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = { abierto = !abierto }) {
                Text(if (abierto) "▾ Diagnóstico" else "▸ Diagnóstico", color = Marca.tinta, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = {
                portapapeles.setText(AnnotatedString(Diagnostico.resumen()))
                plataforma.mensajeBreve("Resumen copiado")
            }) { Text("Copiar", color = Marca.tinta) }
        }
        if (abierto) {
            Dato("Socket", if (diag.socket) "conectado" else "desconectado")
            Dato("Lecturas GPS", "${diag.lecturas} · pantalla apagada ${diag.lecturasPantallaApagada}")
            Dato("Última lectura", "${hace(diag.ultimaLectura)} · ±${diag.precisionM ?: "—"} m")
            Dato("Mayor hueco sin GPS", "${diag.mayorHuecoSeg} s")
            Dato("Posiciones", "${diag.enviadas} · fallidas ${diag.fallidas}")
            Spacer(Modifier.height(6.dp))
            diag.eventos.take(12).forEach {
                Text(it, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Marca.apagado)
            }
        }
    }
}

/* ----------------------------------------------------------------- piezas */

@Composable
fun Columna(contenido: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) { contenido() }
}

@Composable
fun Tarjeta(contenido: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Marca.superficie),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) { Column(Modifier.padding(16.dp)) { contenido() } }
}

@Composable
fun Dato(nombre: String, valor: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(nombre, color = Marca.apagado, fontSize = 15.sp)
        Text(valor, color = Marca.tinta, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

/** El botón principal: amarillo, 64 dp, como los de la PWA. */
@Composable
fun BotonGrande(texto: String, habilitado: Boolean = true, alPulsar: () -> Unit) {
    Button(
        onClick = alPulsar,
        enabled = habilitado,
        modifier = Modifier.fillMaxWidth().height(64.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Marca.amarillo, contentColor = Marca.tinta),
    ) { Text(texto, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
}

@Composable
fun BotonSecundario(texto: String, habilitado: Boolean = true, alPulsar: () -> Unit) {
    OutlinedButton(
        onClick = alPulsar,
        enabled = habilitado,
        modifier = Modifier.fillMaxWidth().height(56.dp),
    ) { Text(texto, color = Marca.tinta, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
}
