package co.sogataxi.conductor

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap

/**
 * Lo que cada sistema hace a su manera.
 *
 * Todo lo demás (la sesión, la cola sin señal, el motor del turno, las
 * pantallas) es el mismo código en Android y en iPhone. Aquí queda solo lo
 * que no se puede compartir: dónde se guarda, cómo se habla por la red, cómo
 * suena una oferta y cómo se sostiene el GPS con la pantalla apagada.
 *
 * Android la implementa en `app/` (`PlataformaAndroid`), iPhone en
 * `shared/src/iosMain` (`PlataformaIos`).
 */
interface Plataforma {
    /** La API de esta versión; en depuración se puede cambiar en el acceso. */
    val apiBasePorDefecto: String
    val apiEditable: Boolean
    val depuracion: Boolean

    /** «OPPO CPH2591», «iPhone 13»: queda registrado en la cuenta al entrar. */
    val dispositivo: String

    /** «Android 14», «iOS 17.5». */
    val sistema: String

    /**
     * El número de versión instalado, para avisar si hay una más nueva.
     * Nulo donde la app no se actualiza descargando un archivo.
     */
    val versionDeLaApp: Int?

    /* ---------------------------------------------------- almacenamiento */

    fun leer(clave: String): String?

    /** `yaMismo`: no vuelve hasta que está en el disco (la cola de etapas). */
    fun guardar(clave: String, valor: String?, yaMismo: Boolean = false)

    /** El token del conductor, cifrado por el sistema (Keystore / Llavero). */
    fun leerSecreto(): String?
    fun guardarSecreto(valor: String?)

    fun uuid(): String

    /* --------------------------------------------------------------- red */

    /** Lanza [SinSenal] si no hubo respuesta del servidor. */
    suspend fun http(
        metodo: String,
        url: String,
        cabeceras: Map<String, String>,
        cuerpo: String?,
        tiempoMs: Int,
    ): RespuestaHttp

    /* ------------------------------------------------------------- turno */

    fun tienePermisoDeUbicacion(): Boolean

    /**
     * Ubicación «todo el tiempo», también con la app cerrada. Es lo que se
     * exige para abrir turno. Por defecto, lo mismo que la de arriba (iPhone
     * la pide aparte en su arranque).
     */
    fun tieneUbicacionSiempre(): Boolean = tienePermisoDeUbicacion()

    /** Lo que falta permitir para que el turno funcione con el teléfono bloqueado. */
    fun requisitos(): List<Requisito>

    /** Solo desde la app en pantalla: de ahí sale el permiso para seguir en segundo plano. */
    fun iniciarTurno()
    fun detenerTurno()

    /* ----------------------------------------------------------- ofertas */

    /** La oferta entra como una llamada: aviso del sistema encima del bloqueo. */
    fun presentarOferta(oferta: OfertaDeCarrera)
    fun retirarOferta()
    fun sonarAlarma()
    fun callarAlarma()

    /* ------------------------------------------------------------ avisos */

    fun avisar(id: Int, titulo: String, texto: String)
    fun quitarAviso(id: Int)

    /* -------------------------------------------------------------- otros */

    fun abrirEnlace(enlace: String)
    fun llamar(telefono: String)
    fun mensajeBreve(texto: String)

    /** Al registro del sistema, solo en depuración (los eventos llevan direcciones). */
    fun registrar(texto: String)
}

/** Se asigna una vez, al arrancar la app, antes de tocar nada más. */
lateinit var plataforma: Plataforma

class RespuestaHttp(val estado: Int, val cuerpo: ByteArray)

class SinSenal(causa: Throwable? = null) : Exception("Sin señal", causa)

/**
 * Un permiso o ajuste del teléfono. `detalle` dice para qué sirve y `accion`
 * es el texto de su botón. `arreglar` nulo: se resuelve pidiendo los permisos.
 */
class Requisito(
    val nombre: String,
    val listo: Boolean,
    val detalle: String? = null,
    val accion: String = "Permitir",
    val arreglar: (() -> Unit)? = null,
)

/** Los avisos al conductor que no son ofertas. El 1 es el turno y el 2 la oferta. */
object Avisos {
    const val INTERRUMPIDO = 3
    const val SIN_GPS = 4

    fun turnoInterrumpido() = plataforma.avisar(
        INTERRUMPIDO,
        "Tu turno se interrumpió",
        "El teléfono cerró la app y dejó de enviar tu ubicación. No estás recibiendo carreras: abre SogaTaxi para seguir en turno.",
    )

    /** Al volver a la app, los avisos de «abre SogaTaxi» ya cumplieron. */
    fun quitar() {
        plataforma.quitarAviso(INTERRUMPIDO)
        plataforma.quitarAviso(SIN_GPS)
    }
}

/** Pide los permisos del turno y avisa al terminar, se hayan dado o no. */
@Composable
expect fun rememberPedirPermisos(alTerminar: () -> Unit): () -> Unit

/** La foto del lugar: de los bytes de la API a algo que Compose pinta. */
expect fun decodificarImagen(bytes: ByteArray): ImageBitmap?
