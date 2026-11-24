package co.sogataxi.conductor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/** Un error de la API con su mensaje para el conductor (RFC 7807: detail o title). */
class ApiError(val status: Int, val codigo: String?, message: String) : Exception(message)

/**
 * Cliente HTTP mínimo contra la misma API de la PWA. Sin librerías: para la
 * fase 0 basta HttpURLConnection y org.json, que vienen con Android.
 */
object Api {
    /** El mismo tope que la PWA: una petición colgada no deja el botón esperando. */
    private const val TIEMPO_MS = 12_000

    suspend fun get(ruta: String): Any? = pedir("GET", ruta, null, idempotente = false)

    suspend fun post(ruta: String, cuerpo: JSONObject? = null, idempotente: Boolean = false): Any? =
        pedir("POST", ruta, cuerpo, idempotente)

    private suspend fun pedir(metodo: String, ruta: String, cuerpo: JSONObject?, idempotente: Boolean): Any? =
        withContext(Dispatchers.IO) {
            val conexion = (URL(Prefs.apiBase + ruta).openConnection() as HttpURLConnection).apply {
                requestMethod = metodo
                connectTimeout = TIEMPO_MS
                readTimeout = TIEMPO_MS
                setRequestProperty("accept", "application/json")
                Prefs.token?.let { setRequestProperty("authorization", "Bearer $it") }
                // Las etapas de la carrera llevan clave de idempotencia, como en
                // la PWA: un reintento por mala señal no las aplica dos veces.
                if (idempotente) setRequestProperty("idempotency-key", UUID.randomUUID().toString())
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
            } finally {
                conexion.disconnect()
            }
        }
}
