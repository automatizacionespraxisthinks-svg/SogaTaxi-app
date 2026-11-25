@file:OptIn(ExperimentalForeignApi::class)

package co.sogataxi.conductor

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.useContents
import platform.CoreLocation.CLActivityTypeAutomotiveNavigation
import platform.CoreLocation.CLLocation
import platform.CoreLocation.CLLocationManager
import platform.CoreLocation.CLLocationManagerDelegateProtocol
import platform.CoreLocation.kCLAuthorizationStatusAuthorizedAlways
import platform.CoreLocation.kCLAuthorizationStatusAuthorizedWhenInUse
import platform.CoreLocation.kCLAuthorizationStatusDenied
import platform.CoreLocation.kCLAuthorizationStatusNotDetermined
import platform.CoreLocation.kCLAuthorizationStatusRestricted
import platform.CoreLocation.kCLDistanceFilterNone
import platform.CoreLocation.kCLLocationAccuracyBest
import platform.CoreLocation.kCLLocationAccuracyHundredMeters
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationState
import platform.darwin.NSObject

/**
 * El GPS del iPhone.
 *
 * Lo que en Android hace el servicio en primer plano, aquí lo hace la
 * ubicación en segundo plano: con `allowsBackgroundLocationUpdates` (y el
 * modo `location` declarado en la app), iOS sigue entregando lecturas con la
 * pantalla bloqueada, y mientras las entrega la app sigue despierta: el
 * socket vive y las ofertas llegan. Igual que en Android, basta el permiso
 * «mientras se usa la app», porque el turno se abre con la app en pantalla.
 */
class GpsIos(private val alLeer: (Lectura) -> Unit) : NSObject(), CLLocationManagerDelegateProtocol {
    private val gestor = CLLocationManager()
    private var alResponder: (() -> Unit)? = null

    init {
        gestor.delegate = this
        gestor.pausesLocationUpdatesAutomatically = false
        gestor.activityType = CLActivityTypeAutomotiveNavigation
    }

    fun tienePermiso(): Boolean = gestor.authorizationStatus.let {
        it == kCLAuthorizationStatusAuthorizedWhenInUse || it == kCLAuthorizationStatusAuthorizedAlways
    }

    /** Ya dijo que no (o el teléfono lo tiene restringido): iOS no vuelve a preguntar. */
    fun negado(): Boolean = gestor.authorizationStatus.let {
        it == kCLAuthorizationStatusDenied || it == kCLAuthorizationStatusRestricted
    }

    fun pedirPermiso(alTerminar: () -> Unit) {
        if (gestor.authorizationStatus != kCLAuthorizationStatusNotDetermined) {
            alTerminar()
            return
        }
        alResponder = alTerminar
        gestor.requestWhenInUseAuthorization()
    }

    override fun locationManagerDidChangeAuthorization(manager: CLLocationManager) {
        alResponder?.invoke()
        alResponder = null
    }

    fun configurar(modo: ModoGps): Boolean {
        if (!tienePermiso()) return false
        // iOS no tiene «cada N segundos»: entrega según precisión y distancia.
        // En pausa, precisión media; el resto, la mejor. Sin filtro de
        // distancia en ningún caso: parqueado también tiene que haber
        // lecturas, o la oficina deja de verlo y iOS duerme la app. El motor
        // decide cuáles envía (cada 30 s en pausa).
        gestor.desiredAccuracy =
            if (modo == ModoGps.PAUSA) kCLLocationAccuracyHundredMeters else kCLLocationAccuracyBest
        gestor.distanceFilter = kCLDistanceFilterNone
        gestor.allowsBackgroundLocationUpdates = true
        // La barra azul de «SogaTaxi está usando tu ubicación»: el conductor
        // sabe que el turno sigue enviando, como la notificación fija de Android.
        gestor.showsBackgroundLocationIndicator = true
        gestor.startUpdatingLocation()
        return true
    }

    fun detener() {
        gestor.stopUpdatingLocation()
        gestor.allowsBackgroundLocationUpdates = false
    }

    override fun locationManager(manager: CLLocationManager, didUpdateLocations: List<*>) {
        val punto = didUpdateLocations.lastOrNull() as? CLLocation ?: return
        // Una precisión negativa es «lectura no válida».
        val precision = punto.horizontalAccuracy.takeIf { it >= 0 }?.toFloat()
        punto.coordinate.useContents { alLeer(Lectura(latitude, longitude, precision)) }
    }
}

/**
 * El turno abierto en iPhone: le presta al motor común el GPS y el socket.
 *
 * No hay servicio ni candado de CPU que cuidar: mientras el GPS entrega
 * lecturas en segundo plano, iOS mantiene la app despierta.
 */
object TurnoIos : AnfitrionDeTurno {
    lateinit var puente: PuenteIos

    private var motor: MotorDeTurno? = null

    val gpsIos = GpsIos { motor?.lectura(it) }

    // Una clase de Objective-C (el delegado del GPS) no puede ser a la vez
    // una interfaz de Kotlin: este es el adaptador.
    override val gps: Gps = object : Gps {
        override fun configurar(modo: ModoGps, intervaloMs: Long): Boolean = gpsIos.configurar(modo)
        override fun detener() = gpsIos.detener()
    }
    override val tiempoReal: TiempoReal by lazy { puente.crearTiempoReal() }

    override fun pantallaEncendida(): Boolean =
        UIApplication.sharedApplication.applicationState == UIApplicationState.UIApplicationStateActive

    override fun latido() {}
    override fun alDetener() {}

    fun iniciar() {
        val actual = motor ?: MotorDeTurno(this).also { motor = it }
        actual.iniciar(revivido = false)
    }

    fun detener() {
        motor?.detener()
    }

    /** iOS va a cerrar la app con el turno abierto: que el conductor lo sepa. */
    fun alCerrarLaApp() {
        if (motor?.activo == true && Prefs.token != null) Avisos.turnoInterrumpido()
    }
}
