package co.sogataxi.conductor

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.roundToInt

/**
 * La sesión del conductor: en qué pantalla está y con qué carrera.
 *
 * La verdad la tiene la API (`GET /v1/driver/rides/me`); aquí se refleja y se
 * guarda lo último que se supo, para abrir sin señal donde estaba. Las mismas
 * reglas que la PWA (`apps/driver/src/App.tsx` y `state/session.ts`).
 */
object Sesion {
    private val estado = MutableStateFlow(EstadoSesion())
    val flujo: StateFlow<EstadoSesion> = estado

    private val escena = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val refrescando = Mutex()

    /** Al abrir la app: lo último que se supo, si hay sesión. */
    fun iniciar() {
        if (Prefs.token == null) {
            estado.value = EstadoSesion(fase = Fase.ACCESO)
            return
        }
        val guardado = Prefs.ultimoEstado?.let {
            runCatching { EstadoSesion.deJson(analizarJson(it) as JsonObject) }.getOrNull()
        }
        estado.value = (guardado ?: EstadoSesion(fase = Fase.FUERA_DE_TURNO))
            .copy(enLinea = false, encoladas = Cola.pendientes().size)
    }

    private fun cambiar(transformar: (EstadoSesion) -> EstadoSesion) {
        estado.update(transformar)
        val nuevo = estado.value
        if (nuevo.fase != Fase.ACCESO) Prefs.ultimoEstado = nuevo.aJson().toString()
    }

    fun avisar(texto: String?) = cambiar { it.copy(aviso = texto) }
    fun encoladas(n: Int) = cambiar { it.copy(encoladas = n) }
    fun enLinea(si: Boolean) = cambiar { it.copy(enLinea = si) }

    /** De diez en diez metros: pintar la pantalla por un metro no le dice nada al conductor. */
    fun acercarse(metros: Float) {
        val redondo = (metros.coerceAtLeast(0f) / 10f).roundToInt() * 10
        if (redondo != estado.value.metrosALaRecogida) cambiar { it.copy(metrosALaRecogida = redondo) }
    }

    /** La carrera en curso, para adjuntar su id a cada posición. */
    val carreraEnCurso: String?
        get() = estado.value.takeIf { it.fase == Fase.CARRERA }?.carrera?.rideId

    fun refrescarLuego() {
        escena.launch { refrescar() }
    }

    /**
     * Recupera el estado de la API. Sin señal se queda con lo que tenía: la
     * pantalla no puede quedarse en blanco porque no hay cobertura.
     */
    suspend fun refrescar() = refrescando.withLock {
        if (Prefs.token == null) return@withLock
        val yo = try {
            // `as?`: un 200 con el cuerpo vacío o que no es JSON (un proxy a
            // medio desplegar) se trata como sin señal, no tumba la app.
            Api.get("/v1/driver/rides/me") as? JsonObject ?: run {
                enLinea(false)
                return@withLock
            }
        } catch (e: ApiError) {
            if (e.status == 401) {
                /*
                 * El token NO se borra (igual que la PWA): un 401 casi siempre
                 * es una suspensión de la oficina, y el token vuelve a servir
                 * cuando lo habiliten. Si revocaron el celular, el servidor
                 * no lo acepta nunca más y se ve esta misma pantalla.
                 */
                cambiar {
                    EstadoSesion(
                        fase = Fase.ACCESO,
                        aviso = "La oficina no reconoce esta sesión: puede estar suspendida. Llama a la oficina o vuelve a entrar.",
                    )
                }
            } else {
                enLinea(false)
            }
            return@withLock
        }

        val reglas = yo.objeto("rules")
        val turno = yo.objeto("shift")
        val totales = yo.objeto("totals")
        val activa = yo.objeto("activeRide")
        val pendiente = yo.objeto("pendingOffer")
        val turnoDesde = instanteMs(turno?.texto("startedAt"))
        turno?.texto("plate")?.let { Prefs.placa = it }
        yo.objeto("driver")?.let { conductor ->
            conductor.texto("name")?.let { Prefs.conductor = it }
            conductor.texto("code")?.let { Prefs.codigo = it }
        }

        val fase = when {
            activa != null -> Fase.CARRERA
            turno != null -> if (turno.booleano("paused")) Fase.PAUSA else Fase.DISPONIBLE
            else -> Fase.FUERA_DE_TURNO
        }

        cambiar { antes ->
            val base = antes.copy(
                turnoDesde = turnoDesde,
                placa = turno?.texto("plate") ?: antes.placa,
                carrerasHoy = totales?.entero("rides") ?: antes.carrerasHoy,
                minutosMinimos = reglas?.entero("minRideMinutes") ?: antes.minutosMinimos,
                radioLlegada = reglas?.entero("arrivalRadiusMeters") ?: antes.radioLlegada,
                enLinea = true,
                // Un aviso de "sin sesión" ya no aplica si la API contestó.
                aviso = antes.aviso?.takeUnless { antes.fase == Fase.ACCESO },
            )
            /*
             * El resumen lo cierra el conductor, no el servidor: al finalizar
             * llega un `ride:changed` que dispara esta recuperación, y sin esta
             * guarda el resumen se borraría en el instante en que aparece.
             */
            if (antes.fase == Fase.RESUMEN && fase != Fase.CARRERA) return@cambiar base
            if (activa != null) {
                val carrera = Carrera.deJson(activa)
                val estadoCarrera = runCatching { EstadoCarrera.valueOf(activa.texto("status")!!) }
                    .getOrDefault(EstadoCarrera.ASSIGNED)
                base.copy(
                    fase = Fase.CARRERA,
                    carrera = carrera.copy(
                        // La hora de subida del teléfono vale hasta que la API diga la suya.
                        abordoDesde = carrera.abordoDesde ?: antes.carrera?.takeIf { it.rideId == carrera.rideId }?.abordoDesde,
                    ),
                    estadoCarrera = estadoCarrera,
                    metrosALaRecogida = base.metrosALaRecogida.takeIf { antes.carrera?.rideId == carrera.rideId },
                )
            } else {
                base.copy(fase = fase, carrera = null, metrosALaRecogida = null)
            }
        }

        // Una oferta viva que el conductor no vio porque estaba sin cobertura.
        if (activa == null && pendiente != null && Ofertas.flujo.value == null) {
            val carrera = pendiente.objeto("ride")
            val rideId = carrera?.texto("id")
            if (carrera != null && rideId != null) {
                Ofertas.mostrar(
                    OfertaDeCarrera(
                        rideId = rideId,
                        codigo = carrera.texto("code").orEmpty(),
                        recogida = carrera.texto("pickupText").orEmpty(),
                        referencia = carrera.texto("pickupReference"),
                        pagoElectronico = carrera.booleano("pagoElectronico"),
                        pasajeros = carrera.entero("passengers") ?: 1,
                        distanciaKm = pendiente.doble("distanceKm") ?: 0.0,
                        etaMin = pendiente.entero("etaMinutes") ?: 0,
                        venceEn = instanteMs(pendiente.texto("expiresAt")) ?: (ahoraMs() + 30_000),
                    ),
                )
            }
        }
    }

    /* ------------------------------------------------------------ acciones */

    suspend fun entrar(codigo: String, pin: String, dispositivo: String): String? = try {
        val cuerpo = buildJsonObject {
            put("code", codigo)
            put("pin", pin)
            put("device", dispositivo.take(120))
            put("install", Prefs.installId)
        }
        val respuesta = Api.post("/v1/auth/driver", cuerpo) as JsonObject
        Prefs.token = respuesta.texto("token") ?: error("La oficina no devolvió la sesión")
        Prefs.codigo = codigo
        Prefs.conductor = respuesta.objeto("driver")?.texto("name").orEmpty()
        cambiar { EstadoSesion(fase = Fase.FUERA_DE_TURNO, placa = Prefs.placa) }
        refrescar()
        null
    } catch (e: Exception) {
        e.message ?: "No se pudo entrar"
    }

    /** Abrir turno va directo: sin señal se le dice y lo intenta de nuevo. */
    suspend fun abrirTurno(placa: String): String? = try {
        Api.post("/v1/driver/shift/open", buildJsonObject { put("plate", placa) })
        Prefs.placa = placa
        Diagnostico.turnoIniciado()
        refrescar()
        null
    } catch (e: Exception) {
        e.message
    }

    suspend fun cerrarTurno(): String? = try {
        Api.post("/v1/driver/shift/close")
        cambiar { it.copy(fase = Fase.FUERA_DE_TURNO, turnoDesde = null, carrera = null) }
        null
    } catch (e: Exception) {
        e.message
    }

    suspend fun pausar(): String? = try {
        Api.post("/v1/driver/shift/pause")
        cambiar { it.copy(fase = Fase.PAUSA) }
        null
    } catch (e: Exception) {
        e.message
    }

    suspend fun reanudar(): String? = try {
        Api.post("/v1/driver/shift/resume")
        cambiar { it.copy(fase = Fase.DISPONIBLE) }
        null
    } catch (e: Exception) {
        e.message
    }

    private fun dondeEstoy(): JsonObject? = Posicion.ultima?.let { (lat, lng) ->
        buildJsonObject {
            put("lat", lat)
            put("lng", lng)
        }
    }

    /** Una etapa de la carrera: la pantalla avanza ya y la acción va por la cola. */
    fun etapa(cual: Etapa) {
        val actual = estado.value
        val carrera = actual.carrera ?: return
        val cuerpo = buildJsonObject { si("at", dondeEstoy()) }
        Cola.encolar("/v1/driver/rides/${carrera.rideId}/${cual.ruta}", cuerpo, cual.nombre)
        Diagnostico.evento("Etapa: ${cual.nombre}${if (actual.enLinea) "" else " (guardada sin señal)"}")
        cambiar {
            when (cual) {
                Etapa.LLEGUE -> it.copy(estadoCarrera = EstadoCarrera.DRIVER_ARRIVED)
                Etapa.A_BORDO -> it.copy(
                    estadoCarrera = EstadoCarrera.IN_PROGRESS,
                    carrera = carrera.copy(abordoDesde = carrera.abordoDesde ?: ahoraMs()),
                )
                Etapa.FINALIZAR -> it.copy(fase = Fase.RESUMEN, carrerasHoy = it.carrerasHoy + 1)
            }
        }
        escena.launch { Cola.vaciar() }
    }

    /** Del resumen a esperar la siguiente. */
    fun volverADisponible() {
        cambiar { it.copy(fase = Fase.DISPONIBLE, carrera = null, estadoCarrera = EstadoCarrera.ASSIGNED) }
        refrescarLuego()
    }

    /** Cancelar por causa mayor: directo, con motivo de la lista. */
    suspend fun cancelar(motivo: String, detalle: String?): String? {
        val carrera = estado.value.carrera ?: return "No hay carrera"
        return try {
            val cuerpo = buildJsonObject {
                put("motivo", motivo)
                si("detalle", detalle?.takeIf { it.isNotBlank() }?.trim())
                si("at", dondeEstoy())
            }
            Api.post("/v1/driver/rides/${carrera.rideId}/cancel", cuerpo, idempotencia = Api.nuevaClave())
            Diagnostico.evento("Canceló la carrera ${carrera.codigo}")
            cambiar { it.copy(fase = Fase.DISPONIBLE, carrera = null, estadoCarrera = EstadoCarrera.ASSIGNED) }
            refrescar()
            null
        } catch (e: Exception) {
            e.message
        }
    }

    /** Cambiar de carro: directo, cierra el turno del de antes y abre el nuevo. */
    suspend fun cambiarCarro(placa: String): String? = try {
        val turno = Api.post("/v1/driver/shift/switch", buildJsonObject { put("plate", placa) }) as? JsonObject
        Prefs.placa = turno?.texto("plate") ?: placa
        refrescar()
        avisar("Listo: ahora vas en el ${Prefs.placa}.")
        null
    } catch (e: Exception) {
        e.message
    }

    /**
     * Cambiar de conductor: no se puede con etapas sin enviar, porque
     * quedarían a nombre de quien sale.
     */
    suspend fun salir(): String? {
        Cola.vaciar()
        if (Cola.hayDelConductor()) return "Hay etapas guardadas sin enviar. Espera a tener señal y vuelve a intentarlo."
        try {
            Api.post("/v1/driver/logout")
        } catch (e: ApiError) {
            if (e.sinSenal) return "Sin señal: no se pudo cerrar la sesión."
            if (e.status != 401) return e.message
        }
        Prefs.salir()
        cambiar { EstadoSesion(fase = Fase.ACCESO) }
        return null
    }

    /** La oficina o el otro celular cerró esta sesión. */
    fun sesionCerrada(motivo: String) {
        Prefs.salir()
        cambiar { EstadoSesion(fase = Fase.ACCESO, aviso = motivo) }
    }
}
