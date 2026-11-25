package co.sogataxi.conductor

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject

/** Hay una versión más nueva de la app publicada por la oficina. */
data class VersionNueva(
    val nombre: String?,
    /** De dónde se descarga. */
    val enlace: String,
    /** La instalada ya no sirve: no se puede abrir turno hasta actualizar. */
    val obligatoria: Boolean,
)

/**
 * El aviso de versión nueva.
 *
 * La app se instala desde un archivo que entrega la empresa, sin tienda que
 * la actualice sola. La API dice cuál es la versión publicada
 * (`GET /v1/app/conductor-android`) y la app, si la suya es más vieja, se lo
 * dice al conductor con un botón que abre la descarga.
 *
 * Nunca se interrumpe una carrera por esto: el aviso es una franja, y lo
 * único que una versión obligatoria impide es ABRIR un turno nuevo.
 */
object Actualizacion {
    private val estado = MutableStateFlow<VersionNueva?>(null)
    val flujo: StateFlow<VersionNueva?> = estado

    /** Con cada vuelta a la app se pregunta, pero no más de una vez cada media hora. */
    private const val CADA_MS = 30 * 60_000L
    private var revisadoEn = 0L

    suspend fun revisar() {
        val instalada = plataforma.versionDeLaApp ?: return
        if (revisadoEn != 0L && ahoraMs() - revisadoEn < CADA_MS) return
        // Sin señal o con la API caída no pasa nada: se pregunta en la próxima.
        val publicada = runCatching { Api.get("/v1/app/conductor-android") as? JsonObject }.getOrNull() ?: return
        revisadoEn = ahoraMs()
        estado.value = decidir(
            instalada = instalada,
            publicada = publicada.entero("versionCode"),
            minima = publicada.entero("minVersionCode"),
            nombre = publicada.texto("versionName"),
            enlace = publicada.texto("url"),
        )
    }

    /** Nulo: no hay nada que avisar. */
    internal fun decidir(instalada: Int, publicada: Int?, minima: Int?, nombre: String?, enlace: String?): VersionNueva? {
        if (publicada == null || enlace == null) return null
        if (publicada <= instalada) return null
        // Solo se abre un enlace web: lo que venga de la API no puede lanzar
        // otra cosa en el teléfono.
        if (!enlace.startsWith("https://") && !enlace.startsWith("http://")) return null
        return VersionNueva(nombre = nombre, enlace = enlace, obligatoria = minima != null && instalada < minima)
    }
}
