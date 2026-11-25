package co.sogataxi.conductor

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
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

/**
 * El turno abierto, como servicio en primer plano de tipo `location`.
 *
 * Es lo que la PWA no puede tener: mientras este servicio vive, Android no
 * congela el GPS al bloquear la pantalla ni al cambiar de app, y el socket
 * sigue abierto para que las ofertas lleguen al instante. A cambio, una
 * notificación fija dice "En turno" (Android la exige y el conductor la ve).
 *
 * Qué se hace con el GPS y con el socket lo decide el motor común
 * (`MotorDeTurno`, el mismo del iPhone). Este servicio le presta lo que es de
 * Android: el primer plano, el GPS de Google Play, el socket y el candado de
 * CPU.
 *
 * Se inicia SOLO desde la app en pantalla (al abrir turno o al abrir la app
 * con el turno ya abierto): así basta el permiso de ubicación "mientras se
 * usa la app". Si Android mata el proceso y lo revive solo (START_STICKY),
 * arranca en segundo plano y puede quedarse sin ubicación: el motor avisa al
 * conductor si pasan dos minutos sin una lectura.
 */
class TurnoService : Service(), AnfitrionDeTurno {
    private val ubicacion by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private val motor = MotorDeTurno(this)
    private var candado: PowerManager.WakeLock? = null
    private var redRegistrada = false

    /** Al volver la red (wifi o datos), se reenvía la cola sin esperar al socket. */
    private val alVolverLaRed = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = motor.volvioLaRed()
    }

    private val alLeer = object : LocationCallback() {
        override fun onLocationResult(resultado: LocationResult) {
            val punto = resultado.lastLocation ?: return
            motor.lectura(
                Lectura(punto.latitude, punto.longitude, if (punto.hasAccuracy()) punto.accuracy else null),
            )
        }
    }

    /* ----------------------------------------- lo que Android le presta al motor */

    override val gps = object : Gps {
        @SuppressLint("MissingPermission")
        override fun configurar(modo: ModoGps, intervaloMs: Long): Boolean {
            val permiso = ContextCompat.checkSelfPermission(
                this@TurnoService, android.Manifest.permission.ACCESS_FINE_LOCATION,
            )
            if (permiso != android.content.pm.PackageManager.PERMISSION_GRANTED) return false
            val prioridad = if (modo == ModoGps.PAUSA) {
                Priority.PRIORITY_BALANCED_POWER_ACCURACY
            } else {
                Priority.PRIORITY_HIGH_ACCURACY
            }
            val pedido = LocationRequest.Builder(prioridad, intervaloMs)
                .setMinUpdateIntervalMillis(intervaloMs)
                .setWaitForAccurateLocation(false)
                .build()
            ubicacion.removeLocationUpdates(alLeer)
            ubicacion.requestLocationUpdates(pedido, alLeer, Looper.getMainLooper())
            return true
        }

        override fun detener() {
            runCatching { ubicacion.removeLocationUpdates(alLeer) }
        }
    }

    override val tiempoReal = object : TiempoReal {
        private var socket: Socket? = null

        override fun conectar(url: String, token: String, eventos: List<String>, oyente: OyenteTiempoReal) {
            desconectar()
            val opciones = IO.Options().apply {
                auth = mapOf("token" to token)
                reconnection = true
                reconnectionDelay = 1_000
                reconnectionDelayMax = 10_000
            }
            socket = IO.socket(url, opciones).apply {
                on(Socket.EVENT_CONNECT) { oyente.conectado() }
                on(Socket.EVENT_DISCONNECT) { oyente.desconectado() }
                on(Socket.EVENT_CONNECT_ERROR) { oyente.desconectado() }
                eventos.forEach { nombre ->
                    on(nombre) { args -> oyente.evento(nombre, args.firstOrNull()?.toString()) }
                }
                connect()
            }
        }

        override fun desconectar() {
            socket?.off()
            socket?.disconnect()
            socket = null
        }
    }

    override fun pantallaEncendida(): Boolean = getSystemService(PowerManager::class.java).isInteractive

    /** Cada 20 s: el candado se renueva antes de que venza su tope. */
    override fun latido() {
        candado?.acquire(TOPE_CANDADO_MS)
    }

    /** El motor ya soltó el GPS y el socket: se suelta lo de Android. */
    override fun alDetener() {
        soltar()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /* -------------------------------------------------------------- servicio */

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == DETENER) {
            motor.detener()
            return START_NOT_STICKY
        }
        if (Prefs.token == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!motor.activo && !entrarEnPrimerPlano()) return START_NOT_STICKY
        if (!motor.activo) {
            tomarCandado()
            motor.iniciar(revivido = intent == null)
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(alVolverLaRed)
            redRegistrada = true
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
        // Sin esto el turno quedaba "zombi": la cabecera seguía en "En vivo",
        // al volver a la app no se reiniciaba el servicio, y el conductor no
        // sabía que había dejado de recibir ofertas.
        Diagnostico.turnoTerminado()
        Avisos.turnoInterrumpido()
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
     * Cuesta batería; el piloto mide cuánta.
     *
     * Con tope: si algo fallara y el servicio no lo soltara, la CPU no queda
     * despierta para siempre. El latido de 20 s lo renueva mientras el turno
     * siga vivo.
     */
    private fun tomarCandado() {
        candado = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SogaTaxi:turno")
            .apply {
                setReferenceCounted(false)
                acquire(TOPE_CANDADO_MS)
            }
    }

    private fun soltar() {
        if (redRegistrada) {
            runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(alVolverLaRed) }
            redRegistrada = false
        }
        candado?.takeIf { it.isHeld }?.release()
        candado = null
    }

    override fun onDestroy() {
        // Si seguía activo, Android lo está matando sin que el conductor
        // cerrara el turno: el motor se lo avisa. El GPS se apaga siempre.
        motor.destruir()
        soltar()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICACION = 1
        private const val DETENER = "co.sogataxi.conductor.DETENER"

        /** Tope del candado de CPU; el latido lo renueva cada 20 s. */
        private const val TOPE_CANDADO_MS = 10 * 60_000L

        /** Solo desde la app en pantalla: ver la nota de la clase. */
        fun iniciar(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, TurnoService::class.java))
        }

        fun detener(context: Context) {
            context.startService(Intent(context, TurnoService::class.java).setAction(DETENER))
        }
    }
}
