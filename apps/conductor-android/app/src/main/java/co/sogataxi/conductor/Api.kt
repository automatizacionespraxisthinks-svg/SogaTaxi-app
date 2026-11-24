package co.sogataxi.conductor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

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
 * Cliente HTTP contra la misma API de la PWA. HttpURLConnection y org.json,
 * que vienen con Android: no hace falta más para unos pocos JSON.
 */
object Api {
    /** El mismo tope que la PWA: una petición colgada no deja el botón esperando. */
    private const val TIEMPO_MS = 12_000

    suspend fun get(ruta: String): Any? = pedir("GET", ruta, null, null)

    suspend fun post(ruta: String, cuerpo: JSONObject? = null, idempotencia: String? = null): Any? =
        pedir("POST", ruta, cuerpo, idempotencia)

    /** Bytes crudos (la foto del lugar), con el token del conductor. */
    suspend fun bytes(ruta: String): ByteArray = withContext(Dispatchers.IO) {
        val conexion = abrir("GET", ruta)
        try {
            val estado = conexion.responseCode
            if (estado !in 200..299) throw ApiError(estado, null, "Error $estado")
            conexion.inputStream.use { it.readBytes() }
        } catch (e: IOException) {
            throw ApiError(0, "SIN_SENAL", "Sin señal")
        } finally {
            conexion.disconnect()
        }
    }

    private fun abrir(metodo: String, ruta: String): HttpURLConnection =
        (URL(Prefs.apiBase + ruta).openConnection() as HttpURLConnection).apply {
            requestMethod = metodo
            connectTimeout = TIEMPO_MS
            readTimeout = TIEMPO_MS
            setRequestProperty("accept", "application/json")
            Prefs.token?.let { setRequestProperty("authorization", "Bearer $it") }
        }

    private suspend fun pedir(metodo: String, ruta: String, cuerpo: JSONObject?, idempotencia: String?): Any? =
        withContext(Dispatchers.IO) {
            val conexion = abrir(metodo, ruta).apply {
                // Las etapas llevan clave de idempotencia, como en la PWA: un
                // reintento por mala señal no las aplica dos veces.
                idempotencia?.let { setRequestProperty("idempotency-key", it) }
                if (cuerpo != null) {
                    doOutput = true
                    setRequestProperty("content-type", "application/json")
                }
            }
            try {
                if (cuerpo != null) conexion.outputStream.use { it.write(cuerpo.toString().toByteArray()) }
                val estado = conexion.responseCode
                val texto = (if (estado in 200..299) conexion.inputStream else conexion.errorStream)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                val json = if (texto.isBlank()) null else runCatching { JSONTokener(texto).nextValue() }.getOrNull()
                if (estado !in 200..299) {
                    val problema = json as? JSONObject
                    val mensaje = problema?.optString("detail")?.takeIf { it.isNotBlank() }
                        ?: problema?.optString("title")?.takeIf { it.isNotBlank() }
                        ?: "Error $estado"
                    throw ApiError(estado, problema?.optString("code")?.takeIf { it.isNotBlank() }, mensaje)
                }
                json
            } catch (e: IOException) {
                throw ApiError(0, "SIN_SENAL", "Sin señal: no se pudo hablar con la oficina.")
            } finally {
                conexion.disconnect()
            }
        }

    fun nuevaClave(): String = UUID.randomUUID().toString()
}
