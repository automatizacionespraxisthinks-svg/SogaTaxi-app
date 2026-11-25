package co.sogataxi.conductor

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Un error de la API con su mensaje para el conductor (RFC 7807: detail o
 * title). `status` 0 es "sin señal": no hubo respuesta del servidor.
 */
class ApiError(val status: Int, val codigo: String?, message: String) : Exception(message) {
    /** Sin red, tiempo agotado, un despliegue en curso (5xx) o demasiadas peticiones (429). */
    val pasajero: Boolean get() = status == 0 || status == 429 || status >= 500
    val sinSenal: Boolean get() = status == 0
}

/**
 * Cliente contra la misma API de la PWA. El transporte lo pone cada sistema
 * (`Plataforma.http`); aquí van las cabeceras, el token y la lectura de los
 * errores, iguales en Android y en iPhone.
 */
object Api {
    /** El mismo tope que la PWA: una petición colgada no deja el botón esperando. */
    private const val TIEMPO_MS = 12_000

    suspend fun get(ruta: String): JsonElement? = pedir("GET", ruta, null, null)

    suspend fun post(ruta: String, cuerpo: JsonObject? = null, idempotencia: String? = null): JsonElement? =
        pedir("POST", ruta, cuerpo, idempotencia)

    /** Bytes crudos (la foto del lugar), con el token del conductor. */
    suspend fun bytes(ruta: String): ByteArray {
        val respuesta = enviar("GET", ruta, cabeceras(), null, "Sin señal")
        if (respuesta.estado !in 200..299) throw ApiError(respuesta.estado, null, "Error ${respuesta.estado}")
        return respuesta.cuerpo
    }

    private fun cabeceras(): MutableMap<String, String> = mutableMapOf("accept" to "application/json").apply {
        Prefs.token?.let { put("authorization", "Bearer $it") }
    }

    private suspend fun enviar(
        metodo: String,
        ruta: String,
        cabeceras: Map<String, String>,
        cuerpo: String?,
        sinSenal: String,
    ): RespuestaHttp = try {
        plataforma.http(metodo, Prefs.apiBase + ruta, cabeceras, cuerpo, TIEMPO_MS)
    } catch (e: SinSenal) {
        throw ApiError(0, "SIN_SENAL", sinSenal)
    }

    private suspend fun pedir(metodo: String, ruta: String, cuerpo: JsonObject?, idempotencia: String?): JsonElement? {
        val cabeceras = cabeceras().apply {
            // Las etapas llevan clave de idempotencia, como en la PWA: un
            // reintento por mala señal no las aplica dos veces.
            idempotencia?.let { put("idempotency-key", it) }
            if (cuerpo != null) put("content-type", "application/json")
        }
        val respuesta = enviar(
            metodo, ruta, cabeceras, cuerpo?.toString(),
            "Sin señal: no se pudo hablar con la oficina.",
        )
        val estado = respuesta.estado
        val json = analizarJson(respuesta.cuerpo.decodeToString())
        if (estado !in 200..299) {
            val problema = json as? JsonObject
            val mensaje = problema?.texto("detail") ?: problema?.texto("title") ?: "Error $estado"
            throw ApiError(estado, problema?.texto("code"), mensaje)
        }
        return json
    }

    fun nuevaClave(): String = plataforma.uuid()
}
