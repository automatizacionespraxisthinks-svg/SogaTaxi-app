package co.sogataxi.conductor

import org.json.JSONObject
import java.time.Instant

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

    fun aJson(): JSONObject = JSONObject()
        .put("id", rideId).put("code", codigo).put("pickupText", recogida)
        .put("pickupReference", referencia).put("pickupLat", lat).put("pickupLng", lng)
        .put("pickupLink", enlace).put("pagoElectronico", pagoElectronico)
        .put("passengers", pasajeros).put("notes", notas)
        .put("customerName", cliente).put("customerPhone", telefono)
        .put("startedAtMs", abordoDesde).put("pickupPhotoAt", fotoEn)

    companion object {
        private fun JSONObject.texto(nombre: String): String? =
            if (isNull(nombre)) null else optString(nombre).takeIf { it.isNotBlank() }

        private fun JSONObject.numero(nombre: String): Double? =
            if (isNull(nombre) || !has(nombre)) null else optDouble(nombre).takeIf { !it.isNaN() }

        /** Desde `activeRide` de la API o desde lo guardado en el teléfono. */
        fun deJson(j: JSONObject): Carrera {
            val sinUbicar = j.texto("pickupSource") == "sin_ubicar"
            val inicio = j.texto("startedAt")?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                ?: if (j.has("startedAtMs") && !j.isNull("startedAtMs")) j.optLong("startedAtMs") else null
            return Carrera(
                rideId = j.getString("id"),
                codigo = j.optString("code"),
                recogida = j.optString("pickupText"),
                referencia = j.texto("pickupReference"),
                lat = if (sinUbicar) null else j.numero("pickupLat"),
                lng = if (sinUbicar) null else j.numero("pickupLng"),
                enlace = j.texto("pickupLink"),
                pagoElectronico = j.optBoolean("pagoElectronico"),
                pasajeros = j.optInt("passengers", 1),
                notas = j.texto("notes"),
                cliente = j.texto("customerName"),
                telefono = j.texto("customerPhone"),
                abordoDesde = inicio,
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
    fun aJson(): JSONObject = JSONObject()
        .put("fase", (if (fase == Fase.RESUMEN) Fase.DISPONIBLE else fase).name)
        .put("estadoCarrera", estadoCarrera.name)
        .put("carrera", carrera?.aJson())
        .put("turnoDesde", turnoDesde)
        .put("placa", placa)
        .put("carrerasHoy", carrerasHoy)
        .put("minutosMinimos", minutosMinimos)
        .put("radioLlegada", radioLlegada)

    companion object {
        fun deJson(j: JSONObject) = EstadoSesion(
            fase = runCatching { Fase.valueOf(j.getString("fase")) }.getOrDefault(Fase.FUERA_DE_TURNO),
            estadoCarrera = runCatching { EstadoCarrera.valueOf(j.getString("estadoCarrera")) }
                .getOrDefault(EstadoCarrera.ASSIGNED),
            carrera = j.optJSONObject("carrera")?.let { Carrera.deJson(it) },
            turnoDesde = if (j.isNull("turnoDesde")) null else j.optLong("turnoDesde"),
            placa = if (j.isNull("placa")) null else j.optString("placa"),
            carrerasHoy = j.optInt("carrerasHoy"),
            minutosMinimos = if (j.isNull("minutosMinimos")) null else j.optInt("minutosMinimos"),
            radioLlegada = j.optInt("radioLlegada", 150),
        )
    }
}
