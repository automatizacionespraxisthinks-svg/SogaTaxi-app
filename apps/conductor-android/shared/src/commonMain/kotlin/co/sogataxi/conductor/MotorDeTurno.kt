package co.sogataxi.conductor

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Cómo se lee el GPS según lo que está haciendo el conductor. */
enum class ModoGps { CARRERA, ESPERA, PAUSA }

class Lectura(val lat: Double, val lng: Double, val precisionM: Float?)

/** El GPS del sistema. Las lecturas se entregan a [MotorDeTurno.lectura], en el hilo principal. */
interface Gps {
    /** Falso si no hay permiso de ubicación. */
    fun configurar(modo: ModoGps, intervaloMs: Long): Boolean
    fun detener()
}

/** El socket `/rt` de la API (socket.io 4), el mismo de la PWA. */
interface TiempoReal {
    /** `eventos`: los únicos que hay que escuchar y pasar a [OyenteTiempoReal.evento]. */
    fun conectar(url: String, token: String, eventos: List<String>, oyente: OyenteTiempoReal)
    fun desconectar()
}

/** Se puede llamar desde cualquier hilo. */
interface OyenteTiempoReal {
    fun conectado()
    fun desconectado()

    /** `json`: el primer argumento del evento, como texto JSON, o nulo. */
    fun evento(nombre: String, json: String?)
}

/** Lo que el sistema le presta al motor mientras el turno está abierto. */
interface AnfitrionDeTurno {
    val gps: Gps
    val tiempoReal: TiempoReal
    fun pantallaEncendida(): Boolean

    /** Cada 20 s con el turno vivo (Android renueva aquí su candado de CPU). */
    fun latido()

    /** El motor ya soltó GPS y socket: el sistema suelta lo suyo. */
    fun alDetener()
}

/**
 * El turno abierto: GPS, socket, cola y vigilancias. Es la parte de la app
 * que tiene que seguir viva con la pantalla apagada.
 *
 * Quién la mantiene viva es cosa de cada sistema: en Android, un servicio en
 * primer plano de tipo `location` (`TurnoService`); en iPhone, la
 * actualización de ubicación en segundo plano (`TurnoIos`). Lo que hace
 * mientras vive es esto, y es lo mismo en los dos.
 */
class MotorDeTurno(private val anfitrion: AnfitrionDeTurno) : OyenteTiempoReal {
    private val escena = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var activo = false
        private set

    private var latido: Job? = null
    private var vigiaDeFase: Job? = null
    private var iniciadoEn = 0L
    private var ultimaLecturaEn = 0L
    private var lecturasEnModo = 0
    private var avisoSinGps = false
    private var modoActual: ModoGps? = null

    /** Segundos entre envíos, en carrera y en espera; los dicta la API (`rules.positionSeconds`). */
    private var cadenciaCarrera = 2
    private var cadenciaEspera = 2
    private var ultimoEnvio = 0L

    /** `revivido`: lo arrancó el sistema solo, no el conductor desde la pantalla. */
    fun iniciar(revivido: Boolean) {
        if (activo) return
        activo = true
        // Si quedaba el aviso de un turno interrumpido, ya no aplica.
        Avisos.quitar()
        avisoSinGps = false
        ultimaLecturaEn = 0L
        Diagnostico.turnoIniciado()
        Diagnostico.evento(if (revivido) "Servicio revivido por el sistema" else "Servicio de turno iniciado")
        leerReglas()
        conectarSocket()
        // Respaldo: cada 20 s, si quedó algo en la cola, se intenta otra vez.
        latido = escena.launch {
            while (isActive) {
                delay(20_000)
                if (Cola.hayDelConductor()) Cola.vaciar()
                anfitrion.latido()
                vigilarGps()
            }
        }
        // El GPS cambia de ritmo con la fase: alta precisión en carrera, a la
        // cadencia de espera cuando está disponible y suave en pausa.
        // Si la sesión se cae con la app en segundo plano (401: la oficina
        // suspendió o revocó el celular), el turno no se queda vivo con el
        // GPS encendido hasta que el conductor abra la app.
        iniciadoEn = ahoraMs()
        vigiaDeFase = escena.launch {
            Sesion.flujo.map { it.fase }.distinctUntilChanged().collect { fase ->
                if (fase == Fase.ACCESO) detener() else configurarGps(modoGps(fase))
            }
        }
    }

    /** Al volver la red (wifi o datos), se reenvía la cola sin esperar al socket. */
    fun volvioLaRed() {
        Diagnostico.evento("Volvió la red")
        escena.launch {
            Cola.vaciar()
            Sesion.refrescar()
        }
    }

    /**
     * El turno puede seguir vivo sin recibir ubicación: si el sistema lo
     * revive con la app cerrada, el permiso «mientras se usa la app» puede
     * dejar de entregar lecturas sin que nada falle. El socket sigue, el
     * conductor cree que está en turno y la oficina lo ve quieto. Si pasan dos
     * minutos sin una sola lectura (fuera de la pausa), se le avisa una vez.
     */
    private fun vigilarGps() {
        if (!activo || avisoSinGps || modoActual == ModoGps.PAUSA) return
        val desde = maxOf(ultimaLecturaEn, iniciadoEn)
        if (ahoraMs() - desde < SIN_GPS_MS) return
        avisoSinGps = true
        Diagnostico.evento("Dos minutos sin lecturas de GPS con el turno abierto")
        plataforma.avisar(
            Avisos.SIN_GPS,
            "No llega tu ubicación",
            "La oficina no ve dónde estás. Abre SogaTaxi y revisa que el GPS esté encendido.",
        )
    }

    private fun leerReglas() = escena.launch {
        runCatching {
            val yo = Api.get("/v1/driver/rides/me") as? JsonObject
            yo?.objeto("rules")?.objeto("positionSeconds")?.let {
                cadenciaCarrera = it.entero("ride") ?: cadenciaCarrera
                cadenciaEspera = it.entero("idle") ?: cadenciaEspera
            }
            // La lectura del GPS en espera va al ritmo de la cadencia nueva.
            modoActual?.let { configurarGps(it, forzar = true) }
            Diagnostico.evento("Cadencia: $cadenciaEspera s en espera, $cadenciaCarrera s en carrera")
        }.onFailure { Diagnostico.evento("No se leyeron las reglas: ${it.message}") }
    }

    /** Una lectura del GPS. Siempre en el hilo principal. */
    fun lectura(punto: Lectura) {
        if (!activo) return
        // En pausa se lee cada 30 s a propósito, y la primera lectura tras
        // cambiar de modo llega cuando llega: ninguna de las dos es un
        // «hueco de GPS» que haya que anotar.
        val contarHueco = modoActual != ModoGps.PAUSA && lecturasEnModo > 0
        lecturasEnModo += 1
        ultimaLecturaEn = ahoraMs()
        if (avisoSinGps) {
            avisoSinGps = false
            plataforma.quitarAviso(Avisos.SIN_GPS)
        }
        Diagnostico.lectura(punto.precisionM, anfitrion.pantallaEncendida(), contarHueco)
        Posicion.ultima = punto.lat to punto.lng

        // Distancia a la recogida mientras va por el cliente: la pantalla
        // dice cuánto falta y si ya puede marcar "Llegué".
        val sesion = Sesion.flujo.value
        val carrera = sesion.carrera
        if (sesion.fase == Fase.CARRERA && sesion.estadoCarrera == EstadoCarrera.ASSIGNED &&
            carrera?.lat != null && carrera.lng != null
        ) {
            Sesion.acercarse(metrosEntre(punto.lat, punto.lng, carrera.lat, carrera.lng))
        }

        val rideId = Sesion.carreraEnCurso
        val cadencia = when {
            rideId != null -> cadenciaCarrera * 1000L
            // En pausa basta una posición cada 30 s. Android ya lee a ese
            // ritmo; el iPhone lee más seguido y aquí se le pone el tope.
            modoActual == ModoGps.PAUSA -> PAUSA_MS
            else -> cadenciaEspera * 1000L
        }
        // Con holgura: la lectura llega al mismo ritmo que el envío, y una
        // que se adelante unos milisegundos no puede saltarse su turno
        // (el taxi se movería a saltos del doble en el mapa).
        if (ahoraMs() - ultimoEnvio < cadencia - HOLGURA_ENVIO_MS) return
        ultimoEnvio = ahoraMs()

        val cuerpo = buildJsonObject {
            put(
                "point",
                buildJsonObject {
                    put("lat", punto.lat)
                    put("lng", punto.lng)
                },
            )
            punto.precisionM?.let { put("accuracyMeters", it.toInt().coerceIn(0, 5000)) }
            rideId?.let { put("rideId", it) }
        }
        escena.launch {
            // Una posición perdida no se reintenta: la siguiente llega en
            // segundos y vale más (igual que la PWA).
            val ok = runCatching { Api.post("/v1/driver/position", cuerpo) }.isSuccess
            Diagnostico.envio(ok)
        }
    }

    private fun modoGps(fase: Fase) = when (fase) {
        Fase.CARRERA, Fase.RESUMEN -> ModoGps.CARRERA
        Fase.PAUSA -> ModoGps.PAUSA
        else -> ModoGps.ESPERA
    }

    /**
     *  - en carrera, alta precisión cada segundo: la distancia a la recogida
     *    y el «Llegué» necesitan el punto fino;
     *  - esperando, alta precisión pero al ritmo de la cadencia de envío:
     *    leer cada segundo para mandar cada dos no aporta;
     *  - en pausa no se le ofrece nada, así que basta una precisión media cada
     *    30 s para que la oficina lo vea en el mapa.
     */
    private fun configurarGps(modo: ModoGps, forzar: Boolean = false) {
        // Nunca después de detener: dejaría el GPS encendido sin turno.
        if (!activo) return
        if (modo == modoActual && !forzar) return
        val intervaloMs = when (modo) {
            ModoGps.CARRERA -> 1_000L
            ModoGps.ESPERA -> (cadenciaEspera * 1000L).coerceAtLeast(1_000L)
            ModoGps.PAUSA -> PAUSA_MS
        }
        if (!anfitrion.gps.configurar(modo, intervaloMs)) {
            Diagnostico.evento("Sin permiso de ubicación: no se envía el GPS")
            return
        }
        modoActual = modo
        lecturasEnModo = 0
        Diagnostico.evento("GPS en modo ${modo.name.lowercase()} (cada ${intervaloMs / 1000} s)")
    }

    private fun conectarSocket() {
        val token = Prefs.token ?: return
        anfitrion.tiempoReal.conectar("${Prefs.apiBase}/rt", token, EVENTOS, this)
    }

    /* ------------------------------------------------- lo que llega del socket */

    override fun conectado() {
        Diagnostico.socket(true)
        // Al reconectar: lo que quedó en la cola y el estado real.
        escena.launch {
            Sesion.enLinea(true)
            Cola.vaciar()
            Sesion.refrescar()
        }
    }

    override fun desconectado() {
        Diagnostico.socket(false)
        escena.launch { Sesion.enLinea(false) }
    }

    override fun evento(nombre: String, json: String?) {
        val datos = json?.let { analizarJson(it) } as? JsonObject
        when (nombre) {
            // La oficina cambió algo de su carrera (la canceló, corrigió la
            // dirección, la reasignó): se pide el estado real.
            "ride:changed" -> escena.launch { Sesion.refrescar() }
            "ride:offer" -> {
                val oferta = datos?.let { runCatching { OfertaDeCarrera.deJson(it) }.getOrNull() } ?: return
                escena.launch { Ofertas.mostrar(oferta) }
            }
            "ride:offer_revoked" -> {
                val rideId = datos?.texto("rideId") ?: return
                escena.launch { Ofertas.retirar(rideId, "La oficina retiró la oferta") }
            }
            "shift:closed" -> {
                val motivo = datos?.texto("motivo").orEmpty()
                escena.launch {
                    Diagnostico.evento("La oficina cerró el turno $motivo")
                    Sesion.avisar("La oficina cerró tu turno. $motivo".trim())
                    Sesion.refrescar()
                    detener()
                }
            }
            "session:closed" -> escena.launch {
                Diagnostico.evento("Sesión cerrada desde otro celular o la oficina")
                Sesion.sesionCerrada("Tu sesión se cerró: entraste en otro celular o la oficina la cerró.")
                detener()
            }
        }
    }

    /* ------------------------------------------------------------------ fin */

    /** Cierra el turno en el teléfono. Se puede llamar aunque no esté activo. */
    fun detener() {
        if (activo) Diagnostico.evento("Servicio de turno detenido")
        activo = false
        latido?.cancel()
        latido = null
        vigiaDeFase?.cancel()
        vigiaDeFase = null
        anfitrion.gps.detener()
        modoActual = null
        anfitrion.tiempoReal.desconectar()
        Diagnostico.turnoTerminado()
        anfitrion.alDetener()
    }

    /**
     * El sistema destruye lo que sostenía el turno. Si seguía activo es que
     * lo mató sin que el conductor cerrara: se le avisa. Devuelve si lo estaba.
     */
    fun destruir(): Boolean {
        val estaba = activo
        if (estaba) {
            Diagnostico.evento("El sistema detuvo el servicio")
            anfitrion.tiempoReal.desconectar()
            // Que la app sepa que ya no corre (si el proceso sigue vivo, al
            // volver a primer plano lo reinicia) y que el conductor lo sepa.
            activo = false
            Diagnostico.turnoTerminado()
            if (Prefs.token != null) Avisos.turnoInterrumpido()
        }
        // Siempre, pase lo que pase antes: el GPS no sobrevive al turno.
        runCatching { anfitrion.gps.detener() }
        escena.cancel()
        return estaba
    }

    companion object {
        private const val HOLGURA_ENVIO_MS = 400L
        private const val SIN_GPS_MS = 120_000L
        private const val PAUSA_MS = 30_000L

        /** Los eventos del socket que le importan al conductor. */
        val EVENTOS = listOf("ride:changed", "ride:offer", "ride:offer_revoked", "shift:closed", "session:closed")
    }
}
