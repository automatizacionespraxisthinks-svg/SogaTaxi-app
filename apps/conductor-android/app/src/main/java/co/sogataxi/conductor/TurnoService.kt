package co.sogataxi.conductor

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * El turno abierto, como servicio en primer plano de tipo `location`.
 *
 * Es lo que la PWA no puede tener: mientras este servicio vive, Android no
 * congela el GPS al bloquear la pantalla ni al cambiar de app, y el socket
 * sigue abierto para que las ofertas lleguen al instante. A cambio, una
 * notificación fija dice "En turno" (Android la exige y el conductor la ve).
 *
 * Se inicia SOLO desde la app en pantalla (al abrir turno o al abrir la app
 * con el turno ya abierto): así basta el permiso de ubicación "mientras se
 * usa la app". Si Android mata el proceso y lo revive solo (START_STICKY),
 * arranca en segundo plano y puede quedarse sin ubicación: la fase 0 mide si
 * eso pasa en cada marca de teléfono.
 */
class TurnoService : Service() {
    private val escena = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val ubicacion by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var socket: Socket? = null
    private var candado: PowerManager.WakeLock? = null
    private var activo = false

    /** Segundos entre envíos, en carrera y en espera; los dicta la API (`rules.positionSeconds`). */
    private var cadenciaCarrera = 2
    private var cadenciaEspera = 2
    private var ultimoEnvio = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == DETENER) {
            detener()
            return START_NOT_STICKY
        }
        if (Prefs.token == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!activo && !entrarEnPrimerPlano()) return START_NOT_STICKY
        if (!activo) {
            activo = true
            Diagnostico.turnoIniciado()
            Diagnostico.evento(if (intent == null) "Servicio revivido por Android" else "Servicio de turno iniciado")
            tomarCandado()
            leerReglas()
            iniciarGps()
            conectarSocket()
        }
        return START_STICKY
    }

    private fun entrarEnPrimerPlano(): Boolean = try {
        ServiceCompat.startForeground(
            this, NOTIFICACION, notificacionDeTurno(),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )
        true
    } catch (e: Exception) {
        // Android 12+ no deja iniciar un servicio de ubicación desde segundo
        // plano. Pasa si Android revive el servicio con la app cerrada.
        Diagnostico.evento("No pudo entrar en primer plano: ${e.javaClass.simpleName}")
        stopSelf()
        false
    }

    private fun notificacionDeTurno(): Notification {
        val abrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, App.CANAL_TURNO)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle("En turno · ${Prefs.placa ?: ""}")
            .setContentText("Enviando tu ubicación a la oficina")
            .setOngoing(true)
            .setContentIntent(abrir)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    /**
     * Un candado parcial: la CPU no se duerme con la pantalla apagada, así el
     * socket responde a los latidos y el envío de posiciones no se congela.
     * Cuesta batería; la fase 0 mide cuánta.
     */
    @SuppressLint("WakelockTimeout")
    private fun tomarCandado() {
        candado = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SogaTaxi:turno")
            .apply { acquire() }
    }

    private fun leerReglas() = escena.launch {
        runCatching {
            val yo = Api.get("/v1/driver/rides/me") as? JSONObject
            yo?.optJSONObject("rules")?.optJSONObject("positionSeconds")?.let {
                cadenciaCarrera = it.optInt("ride", cadenciaCarrera)
                cadenciaEspera = it.optInt("idle", cadenciaEspera)
            }
            Diagnostico.evento("Cadencia: $cadenciaEspera s en espera, $cadenciaCarrera s en carrera")
        }.onFailure { Diagnostico.evento("No se leyeron las reglas: ${it.message}") }
    }

    private val alLeer = object : LocationCallback() {
        override fun onLocationResult(resultado: LocationResult) {
            val punto = resultado.lastLocation ?: return
            val pantalla = getSystemService(PowerManager::class.java).isInteractive
            Diagnostico.lectura(if (punto.hasAccuracy()) punto.accuracy else null, pantalla)
            ultimaPosicion = punto.latitude to punto.longitude

            val cadencia = (if (Prefs.rideId != null) cadenciaCarrera else cadenciaEspera) * 1000L
            if (System.currentTimeMillis() - ultimoEnvio < cadencia) return
            ultimoEnvio = System.currentTimeMillis()

            val cuerpo = JSONObject()
                .put("point", JSONObject().put("lat", punto.latitude).put("lng", punto.longitude))
                .apply {
                    if (punto.hasAccuracy()) put("accuracyMeters", punto.accuracy.toInt().coerceIn(0, 5000))
                    Prefs.rideId?.let { put("rideId", it) }
                }
            escena.launch {
                // Una posición perdida no se reintenta: la siguiente llega en
                // segundos y vale más (igual que la PWA). La cola de posiciones
                // sin señal es de la fase 2.
                val ok = runCatching { Api.post("/v1/driver/position", cuerpo) }.isSuccess
                Diagnostico.envio(ok)
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun iniciarGps() {
        val permiso = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
        if (permiso != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Diagnostico.evento("Sin permiso de ubicación: no se envía el GPS")
            return
        }
        // Una lectura por segundo como máximo; el envío lo espacia la cadencia.
        val pedido = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000)
            .setMinUpdateIntervalMillis(1_000)
            .setWaitForAccurateLocation(false)
            .build()
        ubicacion.requestLocationUpdates(pedido, alLeer, Looper.getMainLooper())
    }

    private fun conectarSocket() {
        val token = Prefs.token ?: return
        val opciones = IO.Options().apply {
            auth = mapOf("token" to token)
            reconnection = true
            reconnectionDelay = 1_000
            reconnectionDelayMax = 10_000
        }
        socket = IO.socket("${Prefs.apiBase}/rt", opciones).apply {
            on(Socket.EVENT_CONNECT) { Diagnostico.socket(true) }
            on(Socket.EVENT_DISCONNECT) { Diagnostico.socket(false) }
            on(Socket.EVENT_CONNECT_ERROR) { Diagnostico.socket(false) }
            on("ride:offer") { args ->
                val json = args.firstOrNull() as? JSONObject ?: return@on
                val oferta = runCatching { OfertaDeCarrera.deJson(json) }.getOrNull() ?: return@on
                escena.launch { Ofertas.mostrar(this@TurnoService, oferta) }
            }
            on("ride:offer_revoked") { args ->
                val rideId = (args.firstOrNull() as? JSONObject)?.optString("rideId") ?: return@on
                escena.launch { Ofertas.retirar(this@TurnoService, rideId, "La oficina retiró la oferta") }
            }
            on("shift:closed") { args ->
                val motivo = (args.firstOrNull() as? JSONObject)?.optString("motivo").orEmpty()
                escena.launch {
                    Diagnostico.evento("La oficina cerró el turno $motivo")
                    detener()
                }
            }
            on("session:closed") {
                escena.launch {
                    Diagnostico.evento("Sesión cerrada desde otro celular o la oficina")
                    Prefs.salir()
                    detener()
                }
            }
            connect()
        }
    }

    private fun detener() {
        if (activo) Diagnostico.evento("Servicio de turno detenido")
        activo = false
        ubicacion.removeLocationUpdates(alLeer)
        socket?.off()
        socket?.disconnect()
        socket = null
        candado?.takeIf { it.isHeld }?.release()
        candado = null
        Diagnostico.turnoTerminado()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (activo) {
            // Android lo está matando sin que el conductor cerrara el turno.
            Diagnostico.evento("Android detuvo el servicio")
            ubicacion.removeLocationUpdates(alLeer)
            socket?.off()
            socket?.disconnect()
            candado?.takeIf { it.isHeld }?.release()
        }
        escena.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICACION = 1
        private const val DETENER = "co.sogataxi.conductor.DETENER"

        /** La última posición leída, para las etapas de la carrera (`at`). */
        @Volatile
        var ultimaPosicion: Pair<Double, Double>? = null

        /** Solo desde la app en pantalla: ver la nota de la clase. */
        fun iniciar(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, TurnoService::class.java))
        }

        fun detener(context: Context) {
            context.startService(Intent(context, TurnoService::class.java).setAction(DETENER))
        }
    }
}
