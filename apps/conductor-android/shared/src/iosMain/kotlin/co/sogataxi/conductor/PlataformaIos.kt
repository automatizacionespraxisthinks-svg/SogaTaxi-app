@file:OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)

package co.sogataxi.conductor

import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.AVFAudio.AVAudioPlayer
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryPlayback
import platform.AVFAudio.AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
import platform.AVFAudio.setActive
import platform.Foundation.NSBundle
import platform.Foundation.NSData
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSMutableURLRequest
import platform.Foundation.NSURL
import platform.Foundation.NSURLSession
import platform.Foundation.NSUUID
import platform.Foundation.NSUserDefaults
import platform.Foundation.create
import platform.Foundation.dataTaskWithRequest
import platform.Foundation.setHTTPBody
import platform.Foundation.setHTTPMethod
import platform.Foundation.setValue
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationOpenSettingsURLString
import platform.UIKit.UIApplicationState
import platform.UIKit.UIDevice
import platform.UserNotifications.UNAuthorizationOptionAlert
import platform.UserNotifications.UNAuthorizationOptionSound
import platform.UserNotifications.UNAuthorizationStatusAuthorized
import platform.UserNotifications.UNAuthorizationStatusDenied
import platform.UserNotifications.UNAuthorizationStatusProvisional
import platform.UserNotifications.UNMutableNotificationContent
import platform.UserNotifications.UNNotification
import platform.UserNotifications.UNNotificationPresentationOptionBanner
import platform.UserNotifications.UNNotificationPresentationOptionSound
import platform.UserNotifications.UNNotificationPresentationOptions
import platform.UserNotifications.UNNotificationRequest
import platform.UserNotifications.UNNotificationSound
import platform.UserNotifications.UNUserNotificationCenter
import platform.UserNotifications.UNUserNotificationCenterDelegateProtocol
import platform.darwin.NSObject
import platform.darwin.dispatch_async
import platform.darwin.dispatch_get_main_queue
import platform.posix.memcpy
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Lo que es más seguro escribir en Swift que en Kotlin, y que la app de
 * iPhone (`iosApp/`) le entrega al código común al arrancar:
 *
 *  - el Llavero (Keychain), donde va el token del conductor;
 *  - el socket `/rt`, con la librería oficial de socket.io para Swift.
 */
interface PuenteIos {
    fun leerSecreto(): String?
    fun guardarSecreto(valor: String?)
    fun crearTiempoReal(): TiempoReal
}

/**
 * iPhone: lo que el código común le pide al sistema.
 *
 * Preferencias en NSUserDefaults con el token en el Llavero, NSURLSession,
 * la oferta como notificación con sonido propio, y el turno sostenido por la
 * ubicación en segundo plano (`TurnoIos`).
 */
class PlataformaIos(
    private val puente: PuenteIos,
    override val apiBasePorDefecto: String,
    override val apiEditable: Boolean,
    override val depuracion: Boolean,
) : Plataforma {
    private val prefs = NSUserDefaults.standardUserDefaults
    private val avisos get() = UNUserNotificationCenter.currentNotificationCenter()

    /** Los permisos de notificación se preguntan al sistema de forma asíncrona: aquí lo último que dijo. */
    private var avisosPermitidos = false
    private var avisosNegados = false

    /** iOS no guarda al delegado: hay que sostenerlo aquí. */
    private val enPantalla = AvisosEnPantalla()

    override val dispositivo: String = "Apple ${UIDevice.currentDevice.model}"
    override val sistema: String = "iOS ${UIDevice.currentDevice.systemVersion}"

    /** En iPhone no hay archivo que descargar: no se avisa de versiones. */
    override val versionDeLaApp: Int? = null

    init {
        avisos.delegate = enPantalla
        refrescarPermisoDeAvisos()
    }

    /* ---------------------------------------------------- almacenamiento */

    override fun leer(clave: String): String? = prefs.stringForKey(clave)

    override fun guardar(clave: String, valor: String?, yaMismo: Boolean) {
        if (valor == null) prefs.removeObjectForKey(clave) else prefs.setObject(valor, forKey = clave)
        // La cola de etapas no puede perderse si iOS mata la app enseguida.
        if (yaMismo) prefs.synchronize()
    }

    override fun leerSecreto(): String? = puente.leerSecreto()
    override fun guardarSecreto(valor: String?) = puente.guardarSecreto(valor)

    override fun uuid(): String = NSUUID().UUIDString().lowercase()

    /* --------------------------------------------------------------- red */

    override suspend fun http(
        metodo: String,
        url: String,
        cabeceras: Map<String, String>,
        cuerpo: String?,
        tiempoMs: Int,
    ): RespuestaHttp = suspendCancellableCoroutine { continuacion ->
        val destino = NSURL.URLWithString(url)
        if (destino == null) {
            continuacion.resumeWithException(SinSenal())
            return@suspendCancellableCoroutine
        }
        val pedido = NSMutableURLRequest(uRL = destino).apply {
            setHTTPMethod(metodo)
            setTimeoutInterval(tiempoMs / 1000.0)
            cabeceras.forEach { (nombre, valor) -> setValue(valor, forHTTPHeaderField = nombre) }
            if (cuerpo != null) setHTTPBody(cuerpo.encodeToByteArray().aNSData())
        }
        val tarea = NSURLSession.sharedSession.dataTaskWithRequest(pedido) { datos, respuesta, error ->
            val http = respuesta as? NSHTTPURLResponse
            if (error != null || http == null) {
                continuacion.resumeWithException(SinSenal())
            } else {
                continuacion.resume(RespuestaHttp(http.statusCode.toInt(), datos?.aByteArray() ?: ByteArray(0)))
            }
        }
        continuacion.invokeOnCancellation { tarea.cancel() }
        tarea.resume()
    }

    /* ------------------------------------------------------------- turno */

    override fun tienePermisoDeUbicacion(): Boolean = TurnoIos.gpsIos.tienePermiso()

    override fun requisitos(): List<Requisito> {
        refrescarPermisoDeAvisos()
        val ubicacion = tienePermisoDeUbicacion()
        return listOf(
            // Si ya dijo que no, iOS no vuelve a preguntar: hay que ir a Ajustes.
            Requisito("Ubicación", ubicacion, if (TurnoIos.gpsIos.negado()) ::abrirAjustes else null),
            Requisito("Notificaciones", avisosPermitidos, if (avisosNegados) ::abrirAjustes else null),
        )
    }

    private fun refrescarPermisoDeAvisos() {
        avisos.getNotificationSettingsWithCompletionHandler { ajustes ->
            val estado = ajustes?.authorizationStatus
            avisosPermitidos = estado == UNAuthorizationStatusAuthorized || estado == UNAuthorizationStatusProvisional
            avisosNegados = estado == UNAuthorizationStatusDenied
        }
    }

    /** Ubicación «mientras se usa la app» y notificaciones; avisa en el hilo principal. */
    fun pedirPermisos(alTerminar: () -> Unit) {
        TurnoIos.gpsIos.pedirPermiso(alTerminar)
        avisos.requestAuthorizationWithOptions(UNAuthorizationOptionAlert or UNAuthorizationOptionSound) { concedido, _ ->
            avisosPermitidos = concedido
            avisosNegados = !concedido
            dispatch_async(dispatch_get_main_queue()) { alTerminar() }
        }
    }

    private fun abrirAjustes() {
        NSURL.URLWithString(UIApplicationOpenSettingsURLString)?.let { abrir(it) }
    }

    override fun iniciarTurno() = TurnoIos.iniciar()
    override fun detenerTurno() = TurnoIos.detener()

    /* ----------------------------------------------------------- ofertas */

    /**
     * Una notificación con el sonido de alarma de la app (`oferta.wav`, 26 s: el «pi-pi» de SogaTaxi repetido).
     * iOS no tiene la «pantalla completa sobre el bloqueo» de Android: el
     * conductor toca el aviso y la oferta está al abrir.
     */
    override fun presentarOferta(oferta: OfertaDeCarrera) {
        notificar(
            ID_OFERTA,
            "Carrera ${oferta.codigo} · ${oferta.etaMin} min",
            oferta.recogida,
            UNNotificationSound.soundNamed(SONIDO_OFERTA),
        )
    }

    override fun retirarOferta() = quitar(ID_OFERTA)

    private var reproductor: AVAudioPlayer? = null

    /**
     * En bucle hasta que conteste o venza, aunque el iPhone esté en silencio.
     * Solo con la app en pantalla: detrás o con el teléfono bloqueado, iOS no
     * deja arrancar audio, y ahí lo que suena es la notificación (28 s). Así
     * tampoco suenan las dos a la vez.
     */
    override fun sonarAlarma() {
        if (reproductor != null) return
        if (UIApplication.sharedApplication.applicationState != UIApplicationState.UIApplicationStateActive) return
        val archivo = NSBundle.mainBundle.URLForResource("oferta", withExtension = "wav")
        if (archivo == null) {
            Diagnostico.evento("No pudo sonar la alarma: falta oferta.wav en la app")
            return
        }
        val sesion = AVAudioSession.sharedInstance()
        sesion.setCategory(AVAudioSessionCategoryPlayback, error = null)
        sesion.setActive(true, error = null)
        val nuevo = AVAudioPlayer(contentsOfURL = archivo, error = null)
        nuevo.numberOfLoops = -1
        if (nuevo.play()) {
            reproductor = nuevo
        } else {
            Diagnostico.evento("No pudo sonar la alarma: iOS no dejó reproducir")
            soltarAudio()
        }
    }

    override fun callarAlarma() {
        val sonaba = reproductor ?: return
        sonaba.stop()
        reproductor = null
        soltarAudio()
    }

    /** Devuelve el audio: la música o la voz de Waze que se cortó vuelve sola. */
    private fun soltarAudio() {
        AVAudioSession.sharedInstance().setActive(
            false,
            withOptions = AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation,
            error = null,
        )
    }

    /* ------------------------------------------------------------ avisos */

    override fun avisar(id: Int, titulo: String, texto: String) =
        notificar("aviso-$id", titulo, texto, UNNotificationSound.defaultSound)

    override fun quitarAviso(id: Int) = quitar("aviso-$id")

    private fun notificar(id: String, titulo: String, texto: String, sonido: UNNotificationSound?) {
        val contenido = UNMutableNotificationContent().apply {
            setTitle(titulo)
            setBody(texto)
            setSound(sonido)
        }
        // Sin disparador: se entrega ya.
        val pedido = UNNotificationRequest.requestWithIdentifier(id, content = contenido, trigger = null)
        avisos.addNotificationRequest(pedido) { error ->
            if (error != null) registrar("No se pudo avisar «$titulo»: ${error.localizedDescription}")
        }
    }

    private fun quitar(id: String) {
        avisos.removePendingNotificationRequestsWithIdentifiers(listOf(id))
        avisos.removeDeliveredNotificationsWithIdentifiers(listOf(id))
    }

    /* -------------------------------------------------------------- otros */

    /** Abre Maps o Waze si están instalados; si no, Safari. El turno sigue vivo detrás. */
    override fun abrirEnlace(enlace: String) {
        val destino = NSURL.URLWithString(enlace)
        if (destino == null) mensajeBreve("No se pudo abrir el mapa") else abrir(destino)
    }

    override fun llamar(telefono: String) {
        NSURL.URLWithString("tel:${telefono.filter { it.isDigit() || it == '+' }}")?.let { abrir(it) }
    }

    private fun abrir(destino: NSURL) {
        UIApplication.sharedApplication.openURL(destino, options = emptyMap<Any?, Any>(), completionHandler = null)
    }

    /** iOS no tiene mensajes flotantes: va en la franja de avisos de la app. */
    override fun mensajeBreve(texto: String) = Sesion.avisar(texto)

    override fun registrar(texto: String) {
        if (depuracion) println("SogaTaxi: $texto")
    }

    private companion object {
        const val ID_OFERTA = "oferta"
        const val SONIDO_OFERTA = "oferta.wav"
    }
}

/**
 * Con la app en pantalla, iOS se calla las notificaciones si nadie le dice lo
 * contrario. Los avisos («No llega tu ubicación») se muestran igual; la
 * oferta no, porque abierta ya ocupa toda la pantalla y suena la alarma.
 */
private class AvisosEnPantalla : NSObject(), UNUserNotificationCenterDelegateProtocol {
    override fun userNotificationCenter(
        center: UNUserNotificationCenter,
        willPresentNotification: UNNotification,
        withCompletionHandler: (UNNotificationPresentationOptions) -> Unit,
    ) {
        val esOferta = willPresentNotification.request.identifier == "oferta"
        withCompletionHandler(
            if (esOferta) 0u else UNNotificationPresentationOptionBanner or UNNotificationPresentationOptionSound,
        )
    }
}

/* ------------------------------------------------------- NSData y ByteArray */

internal fun ByteArray.aNSData(): NSData =
    if (isEmpty()) NSData() else usePinned { NSData.create(bytes = it.addressOf(0), length = size.toULong()) }

internal fun NSData.aByteArray(): ByteArray {
    val bytes = ByteArray(length.toInt())
    if (bytes.isNotEmpty()) bytes.usePinned { memcpy(it.addressOf(0), this.bytes, this.length) }
    return bytes
}
