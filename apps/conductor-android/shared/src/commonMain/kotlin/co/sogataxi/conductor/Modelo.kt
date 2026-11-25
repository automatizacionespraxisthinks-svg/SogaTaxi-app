package co.sogataxi.conductor

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Una pantalla por estado, como la PWA: no hay menús ni navegación que
 * perder bajo el sol.
 */
enum class Fase { ACCESO, FUERA_DE_TURNO, DISPONIBLE, PAUSA, CARRERA, RESUMEN }

/** Los estados vivos de una carrera que ya es del conductor. */
enum class EstadoCarrera { ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS }

/** Una carrera aceptada, tal como la devuelve `GET /v1/driver/rides/me` (`activeRide`). */
data class Carrera(
    val rideId: String,
    val codigo: String,
    val recogida: String,
    val referencia: String? = null,
    /**
     * El punto del cliente. Nulo en una carrera sin ubicar: la API le pone el
     * centro del pueblo para despachar, y ahí no se manda al conductor.
     */
    val lat: Double? = null,
    val lng: Double? = null,
    /** El enlace de ubicación que mandó el cliente: "Ir con Maps" abre este. */
    val enlace: String? = null,
    val pagoElectronico: Boolean = false,
    val pasajeros: Int = 1,
    val notas: String? = null,
    val cliente: String? = null,
    val telefono: String? = null,
    /** Cuándo subió el pasajero: de aquí sale la cuenta atrás de "Finalizar". */
    val abordoDesde: Long? = null,
    /** Si el cliente mandó foto del lugar (y su versión, para no recargarla). */
    val fotoEn: String? = null,
) {
    val tienePunto: Boolean get() = lat != null && lng != null

    fun aJson(): JsonObject = buildJsonObject {
        put("id", rideId)
        put("code", codigo)
        put("pickupText", recogida)
        si("pickupReference", referencia)
        si("pickupLat", lat)
        si("pickupLng", lng)
        si("pickupLink", enlace)
        put("pagoElectronico", pagoElectronico)
        put("passengers", pasajeros)
        si("notes", notas)
        si("customerName", cliente)
        si("customerPhone", telefono)
        si("startedAtMs", abordoDesde)
        si("pickupPhotoAt", fotoEn)
    }

    companion object {
        /** Desde `activeRide` de la API o desde lo guardado en el teléfono. */
        fun deJson(j: JsonObject): Carrera {
            val sinUbicar = j.texto("pickupSource") == "sin_ubicar"
            return Carrera(
                rideId = j.texto("id") ?: error("Carrera sin id"),
                codigo = j.texto("code").orEmpty(),
                recogida = j.texto("pickupText").orEmpty(),
                referencia = j.texto("pickupReference"),
                lat = if (sinUbicar) null else j.doble("pickupLat"),
                lng = if (sinUbicar) null else j.doble("pickupLng"),
                enlace = j.texto("pickupLink"),
                pagoElectronico = j.booleano("pagoElectronico"),
                pasajeros = j.entero("passengers") ?: 1,
                notas = j.texto("notes"),
                cliente = j.texto("customerName"),
                telefono = j.texto("customerPhone"),
                abordoDesde = instanteMs(j.texto("startedAt")) ?: j.largo("startedAtMs"),
                fotoEn = j.texto("pickupPhotoAt"),
            )
        }
    }
}

data class EstadoSesion(
    val fase: Fase = Fase.ACCESO,
    val estadoCarrera: EstadoCarrera = EstadoCarrera.ASSIGNED,
    val carrera: Carrera? = null,
    val turnoDesde: Long? = null,
    val placa: String? = null,
    val carrerasHoy: Int = 0,
    /** Minutos a bordo antes de poder finalizar; los dice la API (`rules.minRideMinutes`). */
    val minutosMinimos: Int? = null,
    /** El radio de "Llegué", en metros, como lo dice la API. */
    val radioLlegada: Int = 150,
    /** Optimista no: decir "conectado" sin estarlo esconde justo el fallo que importa. */
    val enLinea: Boolean = false,
    val encoladas: Int = 0,
    val metrosALaRecogida: Int? = null,
    /** Un mensaje para el conductor (una etapa rechazada, la oficina cerró el turno…). */
    val aviso: String? = null,
) {
    /** Lo que se guarda para abrir sin señal donde estaba. Una oferta no: sin señal no se acepta. */
    fun aJson(): JsonObject = buildJsonObject {
        put("fase", (if (fase == Fase.RESUMEN) Fase.DISPONIBLE else fase).name)
        put("estadoCarrera", estadoCarrera.name)
        si("carrera", carrera?.aJson())
        si("turnoDesde", turnoDesde)
        si("placa", placa)
        put("carrerasHoy", carrerasHoy)
        si("minutosMinimos", minutosMinimos)
        put("radioLlegada", radioLlegada)
    }

    companion object {
        fun deJson(j: JsonObject) = EstadoSesion(
            fase = runCatching { Fase.valueOf(j.texto("fase")!!) }.getOrDefault(Fase.FUERA_DE_TURNO),
            estadoCarrera = runCatching { EstadoCarrera.valueOf(j.texto("estadoCarrera")!!) }
                .getOrDefault(EstadoCarrera.ASSIGNED),
            carrera = j.objeto("carrera")?.let { Carrera.deJson(it) },
            turnoDesde = j.largo("turnoDesde"),
            placa = j.texto("placa"),
            carrerasHoy = j.entero("carrerasHoy") ?: 0,
            minutosMinimos = j.entero("minutosMinimos"),
            radioLlegada = j.entero("radioLlegada") ?: 150,
        )
    }
}

enum class Etapa(val ruta: String, val nombre: String) {
    LLEGUE("arrived", "Llegué"),
    A_BORDO("board", "Pasajero a bordo"),
    FINALIZAR("finish", "Finalizar"),
}

/** La última posición leída, para las etapas de la carrera (`at`). */
object Posicion {
    @kotlin.concurrent.Volatile
    var ultima: Pair<Double, Double>? = null
}
