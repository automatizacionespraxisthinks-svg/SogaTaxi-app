package co.sogataxi.conductor

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
        crearCanales()
        Sesion.iniciar(this)
    }

    private fun crearCanales() {
        val gestor = getSystemService(NotificationManager::class.java)

        // La notificación fija del turno: obligatoria para el servicio en
        // primer plano. Baja: no suena ni vibra, solo dice "estás en turno".
        gestor.createNotificationChannel(
            NotificationChannel(CANAL_TURNO, "Turno abierto", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Aviso fijo mientras el turno está abierto y se envía la ubicación."
                setShowBadge(false)
            },
        )

        // Ofertas: máxima importancia. Sin sonido propio del canal porque la
        // alarma la toca la app en bucle (Alarma.kt) hasta que el conductor
        // conteste o venza la oferta; un sonido de canal suena una sola vez.
        gestor.createNotificationChannel(
            NotificationChannel(CANAL_OFERTAS, "Ofertas de carrera", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Carreras ofrecidas. Suenan como alarma aunque el teléfono esté bloqueado."
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                setBypassDnd(true)
            },
        )
    }

    companion object {
        const val CANAL_TURNO = "turno"
        const val CANAL_OFERTAS = "ofertas"
    }
}
