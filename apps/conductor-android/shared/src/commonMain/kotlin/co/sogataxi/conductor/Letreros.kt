package co.sogataxi.conductor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Los letreros de la app (28/11/2026): avisos de la oficina, de la conexión,
 * de la versión y de los documentos, y la lista de permisos del teléfono.
 *
 * Todos comparten la misma forma —una tarjeta con su distintivo, un título,
 * una explicación y, si hay algo que hacer, un botón— y cuatro tonos. El tono
 * nunca va solo: lo acompañan el signo del distintivo y el título.
 */
enum class Tono(val fondo: Color, val borde: Color, val solido: Color, val signo: String) {
    /** No puede seguir sin atenderlo: documento vencido, versión obligatoria. */
    CRITICO(Color(0xFFFDECE7), Color(0xFFF1B5A3), Color(0xFFDB3810), "!"),

    /** Conviene atenderlo pronto: documento por vencer, etapas sin enviar. */
    ALERTA(Color(0xFFFFF3E0), Color(0xFFEFCB97), Color(0xFFB85F00), "!"),

    /** Un mensaje para leer: lo que dice la oficina. */
    INFO(Color(0xFFFFF8D6), Color(0xFFE6D36B), Color(0xFF141414), "i"),

    /** Una buena noticia o algo ya resuelto: versión nueva, permiso listo. */
    EXITO(Color(0xFFE7F5EC), Color(0xFFA6D6B6), Color(0xFF028E33), "✓"),
}

/** El círculo con el signo del tono. */
@Composable
fun Distintivo(tono: Tono, tamano: Int = 30) {
    Box(Modifier.size(tamano.dp).background(tono.solido, CircleShape), contentAlignment = Alignment.Center) {
        Text(
            tono.signo,
            color = if (tono == Tono.INFO) Marca.amarillo else Color.White,
            fontSize = (tamano * 0.56f).sp,
            fontWeight = FontWeight.Bold,
            lineHeight = (tamano * 0.6f).sp,
        )
    }
}

/** Un botón corto y oscuro, que no se parte en dos líneas por angosto que sea el teléfono. */
@Composable
fun BotonCorto(texto: String, destacado: Boolean = false, alPulsar: () -> Unit) {
    Button(
        onClick = alPulsar,
        modifier = Modifier.height(40.dp),
        shape = RoundedCornerShape(50),
        contentPadding = PaddingValues(horizontal = 16.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (destacado) Marca.amarillo else Marca.tinta,
            contentColor = if (destacado) Marca.tinta else Marca.sobreTinta,
        ),
    ) { Text(texto, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false) }
}

/**
 * Un aviso: distintivo, título, explicación y, si hay algo que hacer, su botón.
 * El contenido extra (la lista de documentos) va debajo de la explicación.
 */
@Composable
fun Letrero(
    tono: Tono,
    titulo: String,
    texto: String? = null,
    accion: String? = null,
    alPulsar: () -> Unit = {},
    contenido: (@Composable () -> Unit)? = null,
) {
    // Con un texto largo el botón va debajo: al lado le dejaba al texto media
    // tarjeta y el letrero crecía a ocho líneas.
    val botonDebajo = accion != null && (texto?.length ?: 0) > 70
    Row(
        Modifier
            .fillMaxWidth()
            .background(tono.fondo, RoundedCornerShape(14.dp))
            .border(1.dp, tono.borde, RoundedCornerShape(14.dp))
            .padding(start = 12.dp, end = 10.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = if (botonDebajo) Alignment.Top else Alignment.CenterVertically,
    ) {
        Distintivo(tono)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(titulo, color = Marca.tinta, fontSize = 16.sp, fontWeight = FontWeight.Bold, lineHeight = 20.sp)
            texto?.let { Text(it, color = Marca.tinta.copy(alpha = 0.78f), fontSize = 14.sp, lineHeight = 19.sp) }
            contenido?.invoke()
            if (accion != null && botonDebajo) {
                Spacer(Modifier.height(6.dp))
                BotonCorto(accion, alPulsar = alPulsar)
            }
        }
        if (accion != null && !botonDebajo) {
            Spacer(Modifier.width(8.dp))
            BotonCorto(accion, alPulsar = alPulsar)
        }
    }
}

/**
 * Los documentos que se le vencen, todos en un solo letrero: tres letreros
 * apilados dejaban la pantalla sin sitio para abrir turno.
 */
@Composable
fun LetreroDeDocumentos(documentos: List<AvisoDeDocumento>) {
    if (documentos.isEmpty()) return
    val vencidos = documentos.count { it.vencido }
    val bloquea = documentos.any { it.bloquea }
    Letrero(
        tono = if (vencidos > 0) Tono.CRITICO else Tono.ALERTA,
        titulo = when {
            vencidos > 1 -> "Tienes $vencidos documentos vencidos"
            vencidos == 1 -> "Tienes un documento vencido"
            documentos.size > 1 -> "Documentos por vencer"
            else -> "Documento por vencer"
        },
    ) {
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            documentos.forEach { documento ->
                Row(verticalAlignment = Alignment.Top) {
                    Box(
                        Modifier
                            .padding(top = 7.dp)
                            .size(7.dp)
                            .background(if (documento.vencido) Tono.CRITICO.solido else Tono.ALERTA.solido, CircleShape),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        documento.texto,
                        color = Marca.tinta,
                        fontSize = 15.sp,
                        lineHeight = 20.sp,
                        fontWeight = if (documento.vencido) FontWeight.Bold else FontWeight.Normal,
                    )
                }
            }
            Text(
                if (bloquea) "No puedes abrir turno hasta que la oficina registre el documento nuevo."
                else "Lleva el documento renovado a la oficina para que actualicen la fecha.",
                color = Marca.tinta.copy(alpha = 0.78f),
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/* ----------------------------------------------------------------- permisos */

/**
 * Lo que tiene que estar permitido para que el turno funcione con el
 * teléfono bloqueado. Si todo está bien, no se muestra.
 *
 * Arriba cuánto falta, con su barra; después lo pendiente —cada cosa con para
 * qué sirve y un botón que no se parte—, y al final lo que ya está listo, en
 * pequeño, para que se vea el avance sin estorbar.
 */
@Composable
fun Chequeo(refresco: Int, alPedirPermisos: () -> Unit) {
    val requisitos = androidx.compose.runtime.remember(refresco) { plataforma.requisitos() }
    val pendientes = requisitos.filterNot { it.listo }
    if (pendientes.isEmpty()) return
    val listos = requisitos.filter { it.listo }

    Tarjeta {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Prepara el teléfono", color = Marca.tinta, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Text(
                    if (pendientes.size == 1) "Falta un paso para no perder carreras."
                    else "Faltan ${pendientes.size} pasos para no perder carreras.",
                    color = Marca.apagado, fontSize = 14.sp, lineHeight = 19.sp,
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                "${listos.size} de ${requisitos.size}",
                color = Marca.tinta, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false,
                modifier = Modifier.background(Marca.fondo, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }

        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(Color(0xFFE6E4DC))) {
            Box(
                Modifier
                    .fillMaxWidth(listos.size.toFloat() / requisitos.size)
                    .fillMaxHeight()
                    .background(Marca.verdeRelleno, RoundedCornerShape(50)),
            )
        }
        Spacer(Modifier.height(6.dp))

        pendientes.forEachIndexed { indice, requisito ->
            if (indice > 0) Spacer(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFEDEBE4)))
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(30.dp).background(Tono.CRITICO.fondo, CircleShape).border(1.dp, Tono.CRITICO.borde, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text("${indice + 1}", color = Marca.rojo, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(requisito.nombre, color = Marca.tinta, fontSize = 16.sp, fontWeight = FontWeight.Bold, lineHeight = 20.sp)
                    requisito.detalle?.let { Text(it, color = Marca.apagado, fontSize = 13.sp, lineHeight = 18.sp) }
                }
                Spacer(Modifier.width(10.dp))
                BotonCorto(requisito.accion, destacado = true, alPulsar = requisito.arreglar ?: alPedirPermisos)
            }
        }

        if (listos.isNotEmpty()) {
            Spacer(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFEDEBE4)))
            Spacer(Modifier.height(10.dp))
            listos.forEach { requisito ->
                Row(Modifier.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Distintivo(Tono.EXITO, tamano = 18)
                    Spacer(Modifier.width(10.dp))
                    Text(requisito.nombre, color = Marca.apagado, fontSize = 14.sp)
                }
            }
        }
    }
}
