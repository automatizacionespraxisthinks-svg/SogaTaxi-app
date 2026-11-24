package co.sogataxi.conductor

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cola de etapas sin señal, como la de la PWA (`apps/driver/src/api/queue.ts`).
 *
 * El conductor marca "Llegué" en una vereda sin cobertura: la acción no se
 * pierde ni bloquea la pantalla. Se guarda en el teléfono, la pantalla avanza
 * y se reenvía al volver la señal.
 *
 * Solo para las ETAPAS de una carrera que ya es suya (llegué, a bordo,
 * finalicé). Aceptar, cancelar, abrir o cerrar turno van directo: hechos más
 * tarde podrían caer sobre algo que ya cambió.
 *
 * Cada acción lleva su clave de idempotencia desde que se crea: si un envío
 * llegó al servidor y se perdió la respuesta, el reintento no la repite. Y
 * es del conductor que la hizo: no se le reenvía con el token de otro.
 */
object Cola {
    data class Accion(
        val id: String,
        val ruta: String,
        val cuerpo: String?,
        val dueno: String?,
        val en: Long,
        val nombre: String,
    )

    private val candado = Mutex()

    fun pendientes(): List<Accion> {
        val texto = Prefs.cola ?: return emptyList()
        return runCatching {
            val arreglo = JSONArray(texto)
            (0 until arreglo.length()).map { i ->
                val j = arreglo.getJSONObject(i)
                Accion(
                    id = j.getString("id"),
                    ruta = j.getString("ruta"),
                    cuerpo = if (j.isNull("cuerpo")) null else j.getString("cuerpo"),
                    dueno = if (j.isNull("dueno")) null else j.getString("dueno"),
                    en = j.optLong("en"),
                    nombre = j.optString("nombre", "una etapa"),
                )
            }
        }.getOrDefault(emptyList())
    }

    private fun guardar(acciones: List<Accion>) {
        Prefs.cola = JSONArray().apply {
            acciones.forEach {
                put(
                    JSONObject().put("id", it.id).put("ruta", it.ruta).put("cuerpo", it.cuerpo)
                        .put("dueno", it.dueno).put("en", it.en).put("nombre", it.nombre),
                )
            }
        }.toString()
        Sesion.encoladas(acciones.size)
    }

    fun encolar(ruta: String, cuerpo: JSONObject?, nombre: String) {
        guardar(
            pendientes() + Accion(
                id = Api.nuevaClave(),
                ruta = ruta,
                cuerpo = cuerpo?.toString(),
                dueno = Prefs.codigo,
                en = System.currentTimeMillis(),
                nombre = nombre,
            ),
        )
    }

    /**
     * Reenvía en orden. Se para ante lo pasajero (sin señal, 5xx, 429) y ante
     * un 401, sin borrar nada; si el servidor rechaza una acción, se descarta
     * y se le dice al conductor. Devuelve si quedó vacía.
     */
    suspend fun vaciar(): Boolean = candado.withLock {
        var huboCambios = false
        while (true) {
            val todas = pendientes()
            val siguiente = todas.firstOrNull { it.dueno == null || it.dueno == Prefs.codigo } ?: break
            try {
                Api.post(siguiente.ruta, siguiente.cuerpo?.let { JSONObject(it) }, idempotencia = siguiente.id)
                Diagnostico.evento("Enviada: ${siguiente.nombre}")
            } catch (e: ApiError) {
                if (e.pasajero || e.status == 401) {
                    Diagnostico.evento("Sigue guardada: ${siguiente.nombre} (${e.message})")
                    if (huboCambios) Sesion.refrescarLuego()
                    return@withLock false
                }
                Sesion.avisar("La oficina no aceptó «${siguiente.nombre}»: ${e.message}")
            }
            guardar(pendientes().filterNot { it.id == siguiente.id })
            huboCambios = true
        }
        if (huboCambios) Sesion.refrescarLuego()
        pendientes().none { it.dueno == null || it.dueno == Prefs.codigo }
    }

    /** Al cambiar de conductor: lo de otro no se envía con el token del que entra. */
    fun hayDelConductor(): Boolean = pendientes().any { it.dueno == null || it.dueno == Prefs.codigo }
}
