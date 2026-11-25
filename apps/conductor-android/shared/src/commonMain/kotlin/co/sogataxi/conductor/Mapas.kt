package co.sogataxi.conductor

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
 *
 * Abrir el enlace o marcar el teléfono lo hace el sistema
 * (`Plataforma.abrirEnlace`, `Plataforma.llamar`).
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

    /** esquema://[usuario@]host[:puerto][ruta] */
    private val PARTES = Regex("^(https?)://([^/?#]*)([^?#]*)")

    internal fun enlaceValido(enlace: String?): String? {
        if (enlace.isNullOrBlank()) return null
        val limpio = enlace.trim()
        val partes = PARTES.find(limpio) ?: return null
        val autoridad = partes.groupValues[2]
        // Con usuario delante («https://google.com@malo.example»), el host es
        // lo que va después de la arroba: eso es lo que se valida.
        val host = autoridad.substringAfterLast('@').substringBefore(':').lowercase()
        if (host.isEmpty()) return null
        if (HOSTS.none { it.matches(host) }) return null
        val ruta = partes.groupValues[3]
        if (Regex("^(www\\.)?google\\.").containsMatchIn(host) && !ruta.startsWith("/maps")) return null
        if (host == "goo.gl" && !ruta.startsWith("/maps")) return null
        return limpio
    }

    private const val HEX = "0123456789ABCDEF"

    /** Como un formulario web: lo raro va en %XX (UTF-8) y el espacio es «+». */
    internal fun codificar(texto: String): String = buildString {
        for (byte in texto.encodeToByteArray()) {
            val c = byte.toInt() and 0xFF
            val letra = c.toChar()
            when {
                letra in 'a'..'z' || letra in 'A'..'Z' || letra in '0'..'9' || letra in "-_.*" -> append(letra)
                c == 0x20 -> append('+')
                else -> append('%').append(HEX[c shr 4]).append(HEX[c and 0x0F])
            }
        }
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
            val consulta = codificar("${carrera.recogida.trim()}, $CONTEXTO")
            return Enlaces(
                maps = "https://www.google.com/maps/dir/?api=1&destination=$consulta&travelmode=driving",
                waze = "https://waze.com/ul?q=$consulta&navigate=yes",
            )
        }
        return null
    }
}
