package co.sogataxi.conductor

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import java.net.URLEncoder

/**
 * "Ir con Maps" e "Ir con Waze", con los mismos enlaces que la PWA
 * (`apps/driver/src/components/IrConMapas.tsx`).
 *
 * Con coordenadas, el enlace lleva al metro exacto. Sin ellas busca la
 * dirección escrita con el pueblo al final, igual que la buscó la API. Las
 * coordenadas de una carrera sin ubicar nunca llegan aquí: son el centro de
 * Sogamoso, y mandar al conductor a la plaza es peor que mandarlo a buscar
 * la dirección.
 *
 * Si el cliente compartió su ubicación, Maps abre el mismo enlace que él
 * mandó, con su pin; Waze va al mismo punto (Waze no abre enlaces de Google).
 */
object Mapas {
    /** Lo mismo que le pone el geocodificador de la API a cada dirección. */
    private const val CONTEXTO = "Sogamoso, Boyacá, Colombia"

    /** Los servicios de mapas que se aceptan como enlace (`enlace-de-mapa.ts`). */
    private val HOSTS = listOf(
        Regex("^(www\\.)?google\\.[a-z.]+$"),
        Regex("^maps\\.google\\.[a-z.]+$"),
        Regex("^maps\\.app\\.goo\\.gl$"),
        Regex("^goo\\.gl$"),
        Regex("^(www\\.)?waze\\.com$"),
        Regex("^maps\\.apple\\.com$"),
        Regex("^(www\\.)?openstreetmap\\.org$"),
    )

    private fun enlaceValido(enlace: String?): String? {
        if (enlace.isNullOrBlank()) return null
        val uri = runCatching { Uri.parse(enlace.trim()) }.getOrNull() ?: return null
        if (uri.scheme != "https" && uri.scheme != "http") return null
        val host = uri.host?.lowercase() ?: return null
        if (HOSTS.none { it.matches(host) }) return null
        val ruta = uri.path.orEmpty()
        if (Regex("^(www\\.)?google\\.").containsMatchIn(host) && !ruta.startsWith("/maps")) return null
        if (host == "goo.gl" && !ruta.startsWith("/maps")) return null
        return enlace.trim()
    }

    data class Enlaces(val maps: String, val waze: String)

    fun enlaces(carrera: Carrera): Enlaces? {
        if (carrera.tienePunto) {
            val ll = "${carrera.lat},${carrera.lng}"
            return Enlaces(
                maps = enlaceValido(carrera.enlace)
                    ?: "https://www.google.com/maps/dir/?api=1&destination=$ll&travelmode=driving",
                waze = "https://waze.com/ul?ll=$ll&navigate=yes",
            )
        }
        if (carrera.recogida.isNotBlank()) {
            val consulta = URLEncoder.encode("${carrera.recogida.trim()}, $CONTEXTO", "UTF-8")
            return Enlaces(
                maps = "https://www.google.com/maps/dir/?api=1&destination=$consulta&travelmode=driving",
                waze = "https://waze.com/ul?q=$consulta&navigate=yes",
            )
        }
        return null
    }

    /**
     * Abre la app de mapas si está instalada; si no, el navegador. La app de
     * conductores sigue viva detrás: el turno es un servicio en primer plano.
     */
    fun abrir(context: Context, enlace: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(enlace)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "No hay una app para abrir el mapa", Toast.LENGTH_SHORT).show()
        }
    }

    /** Llamar al cliente: abre el marcador con el número, sin pedir permiso de llamadas. */
    fun llamar(context: Context, telefono: String) {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$telefono")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
