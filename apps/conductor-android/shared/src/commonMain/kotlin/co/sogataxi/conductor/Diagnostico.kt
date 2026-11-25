package co.sogataxi.conductor

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Lo que el piloto tiene que demostrar, medido en el teléfono:
 *
 *  - que el GPS sigue llegando con la pantalla apagada (`lecturasPantallaApagada`);
 *  - cuánto fue lo más que pasó sin una lectura (`mayorHuecoSeg`): si el
 *    sistema mata el servicio o lo congela, aquí se ve;
 *  - que las posiciones llegan a la API (`enviadas` / `fallidas`);
 *  - que el socket sigue vivo para recibir ofertas.
 *
 * Vive en memoria: si el sistema mata el proceso, se reinicia en cero, y eso
 * también es un dato (aparece en los eventos como "Servicio iniciado").
 */
object Diagnostico {
    data class Estado(
        val turnoDesde: Long? = null,
        val socket: Boolean = false,
        val lecturas: Int = 0,
        val lecturasPantallaApagada: Int = 0,
        val ultimaLectura: Long? = null,
        val mayorHuecoSeg: Long = 0,
        val precisionM: Int? = null,
        val enviadas: Int = 0,
        val fallidas: Int = 0,
        val ultimoEnvio: Long? = null,
        val eventos: List<String> = emptyList(),
    )

    private val estado = MutableStateFlow(Estado())
    val flujo: StateFlow<Estado> = estado

    fun evento(texto: String) {
        // También al registro del sistema, solo en la versión de depuración
        // (en Android: adb logcat -s SogaTaxi). En la final no, porque los
        // eventos llevan la dirección de recogida.
        plataforma.registrar(texto)
        estado.update {
            it.copy(eventos = (listOf("${horaDelDia()}  $texto") + it.eventos).take(60))
        }
    }

    fun turnoIniciado() = estado.update {
        Estado(turnoDesde = ahoraMs(), eventos = it.eventos)
    }

    fun turnoTerminado() = estado.update { it.copy(turnoDesde = null, socket = false) }

    fun socket(conectado: Boolean) {
        if (estado.value.socket != conectado) evento(if (conectado) "Socket conectado" else "Socket desconectado")
        estado.update { it.copy(socket = conectado) }
    }

    fun lectura(precision: Float?, pantallaEncendida: Boolean, contarHueco: Boolean = true) {
        val ahora = ahoraMs()
        val hueco = if (!contarHueco) 0 else estado.value.ultimaLectura?.let { antes -> (ahora - antes) / 1000 } ?: 0
        if (hueco >= 30) evento("Hueco de GPS: $hueco s sin lecturas")
        estado.update {
            it.copy(
                lecturas = it.lecturas + 1,
                lecturasPantallaApagada = it.lecturasPantallaApagada + if (pantallaEncendida) 0 else 1,
                ultimaLectura = ahora,
                mayorHuecoSeg = maxOf(it.mayorHuecoSeg, hueco),
                precisionM = precision?.toInt(),
            )
        }
    }

    fun envio(ok: Boolean) = estado.update {
        if (ok) it.copy(enviadas = it.enviadas + 1, ultimoEnvio = ahoraMs())
        else it.copy(fallidas = it.fallidas + 1)
    }

    /** Un resumen para copiar y pegar en el informe de la prueba. */
    fun resumen(): String {
        val e = estado.value
        val minutos = e.turnoDesde?.let { (ahoraMs() - it) / 60_000 } ?: 0
        return buildString {
            appendLine("SogaTaxi · ${plataforma.dispositivo} · ${plataforma.sistema}")
            appendLine("Turno: $minutos min · socket ${if (e.socket) "conectado" else "caído"}")
            appendLine("Lecturas GPS: ${e.lecturas} (con pantalla apagada: ${e.lecturasPantallaApagada})")
            appendLine("Mayor hueco sin GPS: ${e.mayorHuecoSeg} s")
            appendLine("Posiciones enviadas: ${e.enviadas} · fallidas: ${e.fallidas}")
            appendLine()
            e.eventos.forEach { appendLine(it) }
        }
    }
}
