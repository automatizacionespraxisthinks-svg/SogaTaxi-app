package co.sogataxi.conductor

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Los colores de packages/ui/src/styles/tokens.css. */
object Marca {
    val tinta = Color(0xFF141414)
    val sobreTinta = Color(0xFFF2F2F0)
    val amarillo = Color(0xFFFBD31A)
    val fondo = Color(0xFFF1F0EB)
    val superficie = Color.White
    val apagado = Color(0xFF545A60)
    val verde = Color(0xFF0B7A30)
    val verdeRelleno = Color(0xFF028E33)
    val rojo = Color(0xFFB52D0B)
    val rojoRelleno = Color(0xFFDB3810)
    val naranja = Color(0xFFA35400)
}

@Composable
fun TemaSogaTaxi(contenido: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Marca.amarillo,
            onPrimary = Marca.tinta,
            background = Marca.fondo,
            surface = Marca.superficie,
            onSurface = Marca.tinta,
            error = Marca.rojoRelleno,
        ),
        content = contenido,
    )
}
