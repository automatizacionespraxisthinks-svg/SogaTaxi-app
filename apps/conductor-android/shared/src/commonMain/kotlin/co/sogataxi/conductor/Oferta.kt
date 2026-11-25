package co.sogataxi.conductor

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** Lo que llega en `ride:offer` (OfferPush en realtime.gateway.ts). */
data class OfertaDeCarrera(
    val rideId: String,
    val codigo: String,
    val recogida: String,
    val referencia: String?,
    val pagoElectronico: Boolean,
    val pasajeros: Int,
    val distanciaKm: Double,
    val etaMin: Int,
    val venceEn: Long,
    val prueba: Boolean = false,
) {
    companion object {
        fun deJson(json: JsonObject) = OfertaDeCarrera(
            rideId = json.texto("rideId") ?: error("Oferta sin carrera"),
            codigo = json.texto("code").orEmpty(),
            recogida = json.texto("pickupText").orEmpty(),
            referencia = json.texto("pickupReference"),
            pagoElectronico = json.booleano("pagoElectronico"),
            pasajeros = json.entero("passengers") ?: 1,
            distanciaKm = json.doble("distanceKm") ?: 0.0,
            etaMin = json.entero("etaMinutes") ?: 0,
            venceEn = instanteMs(json.texto("expiresAt")) ?: (ahoraMs() + 45_000),
        )

        /** Una oferta inventada para probar la alerta sin la oficina. */
        fun deMentira() = OfertaDeCarrera(
            rideId = "prueba",
            codigo = "PRUEBA",
            recogida = "Parque principal de Sogamoso",
            referencia = "Prueba de la alerta: no es una carrera real",
            pagoElectronico = false,
            pasajeros = 1,
            distanciaKm = 1.2,
            etaMin = 4,
            venceEn = ahoraMs() + 30_000,
            prueba = true,
        )
    }
}

/**
 * La oferta en pantalla y lo que se hace con ella.
 *
 * Una oferta entra como una llamada: aviso del sistema encima del bloqueo y
 * alarma en bucle. Cómo se ve y cómo suena lo pone cada sistema
 * (`Plataforma.presentarOferta`, `sonarAlarma`); cuándo vence y qué se le
 * dice a la API es lo mismo en Android y en iPhone.
 */
object Ofertas {
    private val escena = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val actual = MutableStateFlow<OfertaDeCarrera?>(null)
    val flujo: StateFlow<OfertaDeCarrera?> = actual

    private var vencimiento: Job? = null

    fun mostrar(oferta: OfertaDeCarrera) {
        actual.value = oferta
        Diagnostico.evento("Oferta ${oferta.codigo}: ${oferta.recogida}")
        plataforma.sonarAlarma()
        plataforma.presentarOferta(oferta)

        vencimiento?.cancel()
        vencimiento = escena.launch {
            delay(maxOf(1_000, oferta.venceEn - ahoraMs()))
            retirar(oferta.rideId, "La oferta venció")
        }
    }

    /** Quita la oferta de la pantalla: la retiró la oficina, venció o ya se contestó. */
    fun retirar(rideId: String, motivo: String) {
        if (actual.value?.rideId != rideId) return
        actual.value = null
        plataforma.callarAlarma()
        plataforma.retirarOferta()
        Diagnostico.evento(motivo)
        // Al final: si quien llama es el propio vencimiento, cancelarlo antes
        // no cambia nada (lo de arriba no suspende), pero así se lee claro.
        vencimiento?.cancel()
        vencimiento = null
    }

    fun aceptar(rideId: String, alTerminar: (String?) -> Unit = {}) {
        val oferta = actual.value ?: return alTerminar("La oferta ya no está")
        plataforma.callarAlarma()
        if (oferta.prueba) {
            retirar(rideId, "Prueba aceptada (no se llamó a la API)")
            return alTerminar(null)
        }
        escena.launch {
            try {
                Api.post("/v1/driver/rides/$rideId/accept", idempotencia = Api.nuevaClave())
                retirar(rideId, "Aceptó la carrera ${oferta.codigo}")
                Sesion.refrescar()
                alTerminar(null)
            } catch (e: Exception) {
                retirar(rideId, "No se pudo aceptar: ${e.message}")
                alTerminar(e.message ?: "No se pudo aceptar")
            }
        }
    }

    fun rechazar(rideId: String) {
        val oferta = actual.value ?: return
        retirar(rideId, "Rechazó la oferta ${oferta.codigo}")
        if (oferta.prueba) return
        escena.launch { runCatching { Api.post("/v1/driver/rides/$rideId/reject") } }
    }

    /** Para el piloto: una oferta de mentira dentro de un rato, a tiempo de bloquear el teléfono. */
    fun probarEn(milisegundos: Long) {
        escena.launch {
            delay(milisegundos)
            mostrar(OfertaDeCarrera.deMentira())
        }
    }
}
