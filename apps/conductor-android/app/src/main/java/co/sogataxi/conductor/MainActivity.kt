package co.sogataxi.conductor

import android.Manifest
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { TemaSogaTaxi { Raiz() } }
    }
}

@Composable
private fun Raiz() {
    var conToken by remember { mutableStateOf(Prefs.token != null) }
    Column(
        Modifier
            .fillMaxSize()
            .background(Marca.fondo),
    ) {
        Cabecera()
        if (conToken) Turno(alSalir = { conToken = false }) else Acceso(alEntrar = { conToken = true })
    }
}

@Composable
private fun Cabecera() {
    val diag by Diagnostico.flujo.collectAsState()
    Column(Modifier.background(Marca.tinta).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("SogaTaxi · Conductor", color = Marca.sobreTinta, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            if (diag.turnoDesde != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Spacer(
                        Modifier.size(8.dp).background(
                            if (diag.socket) Color(0xFF7CE0A4) else Marca.rojoRelleno, CircleShape,
                        ),
                    )
                    Spacer(Modifier.size(6.dp))
                    Text(if (diag.socket) "En vivo" else "Sin conexión", color = Marca.sobreTinta, fontSize = 13.sp)
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

/* ------------------------------------------------------------------ acceso */

@Composable
private fun Acceso(alEntrar: () -> Unit) {
    val escena = rememberCoroutineScope()
    var api by remember { mutableStateOf(Prefs.apiBase) }
    var codigo by remember { mutableStateOf(Prefs.codigo.orEmpty()) }
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Entrar", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Marca.tinta)
        Text("Fase 0 · prueba de GPS y ofertas", color = Marca.apagado)
        OutlinedTextField(
            value = api, onValueChange = { api = it }, label = { Text("Dirección de la API") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        OutlinedTextField(
            value = codigo, onValueChange = { codigo = it.trim() }, label = { Text("Código de conductor") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        OutlinedTextField(
            value = pin, onValueChange = { pin = it.filter(Char::isDigit).take(6) }, label = { Text("PIN") },
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
                try {
                    val cuerpo = JSONObject()
                        .put("code", codigo)
                        .put("pin", pin)
                        .put("device", "${Build.MANUFACTURER} ${Build.MODEL} (app nativa)".take(120))
                        .put("install", Prefs.installId)
                    val respuesta = Api.post("/v1/auth/driver", cuerpo) as JSONObject
                    Prefs.token = respuesta.getString("token")
                    Prefs.codigo = codigo
                    Prefs.conductor = respuesta.getJSONObject("driver").optString("name")
                    alEntrar()
                } catch (e: Exception) {
                    error = e.message ?: "No se pudo entrar"
                } finally {
                    enviando = false
                }
            }
        }
    }
}

/* ------------------------------------------------------------------- turno */

@Composable
private fun Turno(alSalir: () -> Unit) {
    val contexto = LocalContext.current
    val escena = rememberCoroutineScope()
    val diag by Diagnostico.flujo.collectAsState()
    var enTurno by remember { mutableStateOf(diag.turnoDesde != null) }
    var placa by remember { mutableStateOf(Prefs.placa.orEmpty()) }
    var rideId by remember { mutableStateOf(Prefs.rideId) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresco by remember { mutableIntStateOf(0) }

    val pedirPermisos = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        refresco++
    }

    // Al volver a la app: estado real del turno en la API, y si está abierto
    // pero el servicio no corre (Android lo mató), se vuelve a iniciar desde
    // aquí, que es primer plano.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        refresco++
        rideId = Prefs.rideId
        escena.launch {
            runCatching {
                val yo = Api.get("/v1/driver/rides/me") as JSONObject
                val turno = yo.optJSONObject("shift")
                enTurno = turno != null
                turno?.optString("plate")?.let { Prefs.placa = it; placa = it }
                if (turno != null && Diagnostico.flujo.value.turnoDesde == null && tienePermisoDeUbicacion(contexto)) {
                    TurnoService.iniciar(contexto)
                }
                if (turno == null && Diagnostico.flujo.value.turnoDesde != null) TurnoService.detener(contexto)
            }.onFailure {
                if (it is ApiError && it.status == 401) {
                    Prefs.salir()
                    alSalir()
                }
            }
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Hola, ${Prefs.conductor ?: "conductor"}",
            fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Marca.tinta,
        )

        Chequeo(refresco, alPedirPermisos = {
            pedirPermisos.launch(
                buildList {
                    add(Manifest.permission.ACCESS_FINE_LOCATION)
                    add(Manifest.permission.ACCESS_COARSE_LOCATION)
                    if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                }.toTypedArray(),
            )
        })

        error?.let { Text(it, color = Marca.rojo) }

        if (!enTurno) {
            OutlinedTextField(
                value = placa, onValueChange = { placa = it.uppercase().filter(Char::isLetterOrDigit).take(10) },
                label = { Text("Placa del vehículo de hoy") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            BotonGrande("Abrir turno", habilitado = placa.length >= 5) {
                if (!tienePermisoDeUbicacion(contexto)) {
                    error = "Primero permite la ubicación (arriba)."
                    return@BotonGrande
                }
                error = null
                escena.launch {
                    try {
                        Api.post("/v1/driver/shift/open", JSONObject().put("plate", placa))
                        Prefs.placa = placa
                        TurnoService.iniciar(contexto)
                        enTurno = true
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            }
        } else {
            Tarjeta {
                Text("En turno · ${Prefs.placa}", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(
                    "Bloquea el teléfono, guárdalo y sigue tu día: el GPS sigue llegando a la oficina.",
                    color = Marca.apagado,
                )
            }

            rideId?.let { id ->
                CarreraEnCurso(id, alTerminar = { rideId = null; Prefs.rideId = null }, alError = { error = it })
            }

            OutlinedButton(
                onClick = {
                    Toast.makeText(contexto, "Bloquea el teléfono: la alerta llega en 10 s", Toast.LENGTH_LONG).show()
                    Handler(Looper.getMainLooper()).postDelayed(
                        { Ofertas.mostrar(contexto.applicationContext, OfertaDeCarrera.deMentira()) }, 10_000,
                    )
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Probar la alerta de oferta (en 10 s)", color = Marca.tinta) }

            OutlinedButton(
                onClick = {
                    escena.launch {
                        try {
                            Api.post("/v1/driver/shift/close")
                            TurnoService.detener(contexto)
                            enTurno = false
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Cerrar turno", color = Marca.rojo) }
        }

        PanelDiagnostico(diag)

        TextButton(onClick = {
            escena.launch {
                runCatching { Api.post("/v1/driver/logout") }
                TurnoService.detener(contexto)
                Prefs.salir()
                alSalir()
            }
        }) { Text("Salir de este celular", color = Marca.apagado) }
    }
}

@Composable
private fun CarreraEnCurso(rideId: String, alTerminar: () -> Unit, alError: (String?) -> Unit) {
    val escena = rememberCoroutineScope()
    var enviando by remember { mutableStateOf(false) }

    fun etapa(ruta: String, final: Boolean) {
        enviando = true
        escena.launch {
            try {
                val cuerpo = JSONObject().apply {
                    TurnoService.ultimaPosicion?.let { (lat, lng) ->
                        put("at", JSONObject().put("lat", lat).put("lng", lng))
                    }
                }
                Api.post("/v1/driver/rides/$rideId/$ruta", cuerpo, idempotente = true)
                Diagnostico.evento("Etapa: $ruta")
                alError(null)
                if (final) alTerminar()
            } catch (e: Exception) {
                alError(e.message)
            } finally {
                enviando = false
            }
        }
    }

    Tarjeta {
        Text("Carrera en curso", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text("Las etapas van a la misma API que la PWA.", color = Marca.apagado)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotonEtapa("Llegué", Marca.tinta, Modifier.weight(1f), !enviando) { etapa("arrived", false) }
            BotonEtapa("A bordo", Marca.rojoRelleno, Modifier.weight(1f), !enviando) { etapa("board", false) }
            BotonEtapa("Finalizar", Marca.verde, Modifier.weight(1f), !enviando) { etapa("finish", true) }
        }
    }
}

/* -------------------------------------------------------- chequeo y diagnóstico */

@Composable
private fun Chequeo(refresco: Int, alPedirPermisos: () -> Unit) {
    val contexto = LocalContext.current
    // `refresco` cambia al volver de los ajustes: se recalcula todo.
    val ubicacion = remember(refresco) { tienePermisoDeUbicacion(contexto) }
    val avisos = remember(refresco) { NotificationManagerCompat.from(contexto).areNotificationsEnabled() }
    val pantallaCompleta = remember(refresco) {
        Build.VERSION.SDK_INT < 34 ||
            contexto.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    }
    val bateria = remember(refresco) {
        contexto.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(contexto.packageName)
    }
    if (ubicacion && avisos && pantallaCompleta && bateria) return

    Tarjeta {
        Text("Antes del turno", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text("Sin esto el teléfono puede dejar de enviar el GPS o no sonar.", color = Marca.apagado)
        Spacer(Modifier.height(6.dp))
        FilaChequeo("Ubicación", ubicacion, alPedirPermisos)
        FilaChequeo("Notificaciones", avisos, alPedirPermisos)
        FilaChequeo("Ofertas a pantalla completa", pantallaCompleta) {
            if (Build.VERSION.SDK_INT >= 34) {
                contexto.startActivity(
                    Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${contexto.packageName}")),
                )
            }
        }
        FilaChequeo("Sin límite de batería", bateria) {
            contexto.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${contexto.packageName}")),
            )
        }
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

@Composable
private fun PanelDiagnostico(diag: Diagnostico.Estado) {
    val contexto = LocalContext.current
    var ahora by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            ahora = System.currentTimeMillis()
            kotlinx.coroutines.delay(1_000)
        }
    }
    fun hace(t: Long?) = t?.let { "hace ${(ahora - it) / 1000} s" } ?: "—"

    Tarjeta {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Diagnóstico de la prueba", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            TextButton(onClick = {
                contexto.getSystemService(ClipboardManager::class.java)
                    .setPrimaryClip(ClipData.newPlainText("Fase 0", Diagnostico.resumen()))
                Toast.makeText(contexto, "Resumen copiado", Toast.LENGTH_SHORT).show()
            }) { Text("Copiar", color = Marca.tinta, fontWeight = FontWeight.Bold) }
        }
        Dato("Socket", if (diag.socket) "conectado" else "desconectado")
        Dato("Lecturas GPS", "${diag.lecturas} · con pantalla apagada ${diag.lecturasPantallaApagada}")
        Dato("Última lectura", "${hace(diag.ultimaLectura)} · ±${diag.precisionM ?: "—"} m")
        Dato("Mayor hueco sin GPS", "${diag.mayorHuecoSeg} s")
        Dato("Posiciones enviadas", "${diag.enviadas} · fallidas ${diag.fallidas} · última ${hace(diag.ultimoEnvio)}")
        if (diag.eventos.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            diag.eventos.take(12).forEach {
                Text(it, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Marca.apagado)
            }
        }
    }
}

/* ----------------------------------------------------------------- piezas */

@Composable
private fun Tarjeta(contenido: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Marca.superficie),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) { Column(Modifier.padding(16.dp)) { contenido() } }
}

@Composable
private fun Dato(nombre: String, valor: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(nombre, color = Marca.apagado, fontSize = 14.sp)
        Text(valor, color = Marca.tinta, fontSize = 14.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun BotonGrande(texto: String, habilitado: Boolean = true, alPulsar: () -> Unit) {
    Button(
        onClick = alPulsar,
        enabled = habilitado,
        modifier = Modifier.fillMaxWidth().height(64.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Marca.amarillo, contentColor = Marca.tinta),
    ) { Text(texto, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun BotonEtapa(texto: String, color: Color, modifier: Modifier, habilitado: Boolean, alPulsar: () -> Unit) {
    Button(
        onClick = alPulsar,
        enabled = habilitado,
        modifier = modifier.height(64.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White),
    ) { Text(texto, fontWeight = FontWeight.Bold) }
}

private fun tienePermisoDeUbicacion(contexto: Context) =
    ContextCompat.checkSelfPermission(contexto, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
