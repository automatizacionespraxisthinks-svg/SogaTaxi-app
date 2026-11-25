package co.sogataxi.conductor

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // Antes que nada: el código común no puede guardar, hablar por la red
        // ni avisar sin saber en qué sistema está.
        plataforma = PlataformaAndroid(this)
        crearCanales()
        Sesion.iniciar()
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

        // Avisos al conductor que no son ofertas: hoy, que el turno se
        // interrumpió porque Android cerró la app. Suena una vez (sonido del
        // canal) para que no se quede sin saber que dejó de recibir carreras.
        gestor.createNotificationChannel(
            NotificationChannel(CANAL_AVISOS, "Avisos del turno", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Avisa si el turno dejó de enviar la ubicación y de recibir ofertas."
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            },
        )
    }

    companion object {
        const val CANAL_TURNO = "turno"
        const val CANAL_OFERTAS = "ofertas"
        const val CANAL_AVISOS = "avisos"
    }
}
