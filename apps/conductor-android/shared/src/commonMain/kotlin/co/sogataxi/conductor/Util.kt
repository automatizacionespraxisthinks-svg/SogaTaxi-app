package co.sogataxi.conductor

import kotlinx.datetime.Clock
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/* ------------------------------------------------------------------ tiempo */

fun ahoraMs(): Long = Clock.System.now().toEpochMilliseconds()

/** Una fecha de la API («2026-11-25T14:03:00.000Z») en milisegundos; nulo si no se entiende. */
fun instanteMs(iso: String?): Long? =
    iso?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() }

/** HH:mm:ss, en la hora del teléfono. */
fun horaDelDia(): String {
    val t = Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault())
    return "${dosDigitos(t.hour.toLong())}:${dosDigitos(t.minute.toLong())}:${dosDigitos(t.second.toLong())}"
}

/* ----------------------------------------------------------------- formato */

fun dosDigitos(n: Long): String = n.toString().padStart(2, '0')

/** Un decimal, con coma: «1,2». */
fun unDecimal(valor: Double): String {
    val decimas = (valor * 10).roundToLong()
    val signo = if (decimas < 0) "-" else ""
    return "$signo${abs(decimas) / 10},${abs(decimas) % 10}"
}

/* --------------------------------------------------------------- distancia */

/** Metros entre dos puntos (haversine). Para «A 300 m» y el radio de «Llegué». */
fun metrosEntre(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Float {
    val radio = 6_371_008.8
    val aRad = kotlin.math.PI / 180
    val dLat = (lat2 - lat1) * aRad
    val dLng = (lng2 - lng1) * aRad
    val h = sin(dLat / 2).pow(2) + cos(lat1 * aRad) * cos(lat2 * aRad) * sin(dLng / 2).pow(2)
    return (2 * radio * asin(min(1.0, sqrt(h)))).toFloat()
}

/* -------------------------------------------------------------------- JSON */

/** Nulo si el texto no es JSON: un proxy a medio desplegar no tumba la app. */
fun analizarJson(texto: String): JsonElement? =
    if (texto.isBlank()) null else runCatching { Json.parseToJsonElement(texto) }.getOrNull()

private fun JsonObject.primitivo(nombre: String): JsonPrimitive? =
    (this[nombre] as? JsonPrimitive)?.takeUnless { it is JsonNull }

/** Nulo si falta, es `null` o está en blanco. */
fun JsonObject.texto(nombre: String): String? = primitivo(nombre)?.content?.takeIf { it.isNotBlank() }

fun JsonObject.largo(nombre: String): Long? =
    primitivo(nombre)?.let { it.longOrNull ?: it.doubleOrNull?.takeIf { d -> !d.isNaN() }?.toLong() }

fun JsonObject.entero(nombre: String): Int? = largo(nombre)?.toInt()

fun JsonObject.doble(nombre: String): Double? = primitivo(nombre)?.doubleOrNull?.takeIf { !it.isNaN() }

fun JsonObject.booleano(nombre: String): Boolean = primitivo(nombre)?.booleanOrNull ?: false

fun JsonObject.objeto(nombre: String): JsonObject? = this[nombre] as? JsonObject

/** Como `put`, pero lo nulo no se escribe: la API no espera `null` en lo opcional. */
fun JsonObjectBuilder.si(nombre: String, valor: String?) {
    if (valor != null) put(nombre, valor)
}

fun JsonObjectBuilder.si(nombre: String, valor: Number?) {
    if (valor != null) put(nombre, valor)
}

fun JsonObjectBuilder.si(nombre: String, valor: JsonElement?) {
    if (valor != null) put(nombre, valor)
}
