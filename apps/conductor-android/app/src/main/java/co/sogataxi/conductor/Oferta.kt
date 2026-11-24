package co.sogataxi.conductor

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant

/** Lo que llega en `ride:offer` (OfferPush en realtime.gateway.ts). */
data class OfertaDeCarrera(
    val rideId: String,
    val codigo: String,
    val recogida: String,
    val referencia: String?,
    val pagoElectronico: Boolean,
    val pasajeros: Int,
    val distanciaKm: Double,
    val etaMin: Int,
    val venceEn: Long,
    val prueba: Boolean = false,
) {
    companion object {
        fun deJson(json: JSONObject) = OfertaDeCarrera(
            rideId = json.getString("rideId"),
            codigo = json.optString("code"),
            recogida = json.optString("pickupText"),
            referencia = json.optString("pickupReference").takeIf { it.isNotBlank() && it != "null" },
            pagoElectronico = json.optBoolean("pagoElectronico"),
            pasajeros = json.optInt("passengers", 1),
            distanciaKm = json.optDouble("distanceKm", 0.0),
            etaMin = json.optInt("etaMinutes", 0),
            venceEn = runCatching { Instant.parse(json.getString("expiresAt")).toEpochMilli() }
                .getOrElse { System.currentTimeMillis() + 45_000 },
        )

        /** Una oferta inventada para probar la alerta sin la oficina. */
        fun deMentira() = OfertaDeCarrera(
            rideId = "prueba",
            codigo = "PRUEBA",
            recogida = "Parque principal de Sogamoso",
            referencia = "Prueba de la alerta: no es una carrera real",
            pagoElectronico = false,
            pasajeros = 1,
            distanciaKm = 1.2,
            etaMin = 4,
            venceEn = System.currentTimeMillis() + 30_000,
            prueba = true,
        )
    }
}

/**
 * La oferta en pantalla y lo que se hace con ella.
 *
 * Una oferta entra como una llamada: notificación de pantalla completa
 * (despierta el teléfono y se pone encima del bloqueo) + alarma en bucle.
 * Si el conductor está usando el teléfono, Android la muestra como aviso
 * flotante con los botones Aceptar y Rechazar.
 */
object Ofertas {
    private const val NOTIFICACION = 2
    private val escena = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val principal = Handler(Looper.getMainLooper())

    private val actual = MutableStateFlow<OfertaDeCarrera?>(null)
    val flujo: StateFlow<OfertaDeCarrera?> = actual

    private val vencer = Runnable { actual.value?.let { retirar(appContext, it.rideId, "La oferta venció") } }
    private lateinit var appContext: Context

    fun mostrar(context: Context, oferta: OfertaDeCarrera) {
        appContext = context.applicationContext
        actual.value = oferta
        Diagnostico.evento("Oferta ${oferta.codigo}: ${oferta.recogida}")
        Alarma.sonar(appContext)

        val abrir = PendingIntent.getActivity(
            appContext, 0,
            Intent(appContext, OfertaActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notificacion = NotificationCompat.Builder(appContext, App.CANAL_OFERTAS)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle("Carrera ${oferta.codigo} · ${oferta.etaMin} min")
            .setContentText(oferta.recogida)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(abrir, true)
            .setContentIntent(abrir)
            .setTimeoutAfter(maxOf(5_000, oferta.venceEn - System.currentTimeMillis()))
            .addAction(0, "Rechazar", accion(AccionOfertaReceiver.RECHAZAR, oferta.rideId))
            // Aceptar abre una actividad directamente: desde Android 12 un
            // botón de notificación no puede pasar por un receptor para luego
            // abrir la app ("trampolín" bloqueado).
            .addAction(
                0, "ACEPTAR",
                PendingIntent.getActivity(
                    appContext, 1,
                    Intent(appContext, OfertaActivity::class.java)
                        .setAction(OfertaActivity.ACEPTAR)
                        .putExtra("rideId", oferta.rideId)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
        appContext.getSystemService(NotificationManager::class.java).notify(NOTIFICACION, notificacion)

        principal.removeCallbacks(vencer)
        principal.postDelayed(vencer, maxOf(1_000, oferta.venceEn - System.currentTimeMillis()))
    }

    /** Quita la oferta de la pantalla: la retiró la oficina, venció o ya se contestó. */
    fun retirar(context: Context, rideId: String, motivo: String) {
        if (actual.value?.rideId != rideId) return
        actual.value = null
        principal.removeCallbacks(vencer)
        Alarma.callar()
        context.getSystemService(NotificationManager::class.java).cancel(NOTIFICACION)
        Diagnostico.evento(motivo)
    }

    fun aceptar(context: Context, rideId: String, alTerminar: (String?) -> Unit = {}) {
        val oferta = actual.value ?: return alTerminar("La oferta ya no está")
        Alarma.callar()
        if (oferta.prueba) {
            retirar(context, rideId, "Prueba aceptada (no se llamó a la API)")
            return alTerminar(null)
        }
        escena.launch {
            try {
                Api.post("/v1/driver/rides/$rideId/accept", idempotente = true)
                Prefs.rideId = rideId
                retirar(context, rideId, "Aceptó la carrera ${oferta.codigo}")
                alTerminar(null)
            } catch (e: Exception) {
                retirar(context, rideId, "No se pudo aceptar: ${e.message}")
                alTerminar(e.message ?: "No se pudo aceptar")
            }
        }
    }

    fun rechazar(context: Context, rideId: String) {
        val oferta = actual.value ?: return
        retirar(context, rideId, "Rechazó la oferta ${oferta.codigo}")
        if (oferta.prueba) return
        escena.launch { runCatching { Api.post("/v1/driver/rides/$rideId/reject") } }
    }

    private fun accion(cual: String, rideId: String): PendingIntent = PendingIntent.getBroadcast(
        appContext, cual.hashCode(),
        Intent(appContext, AccionOfertaReceiver::class.java).setAction(cual).putExtra("rideId", rideId),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

/** El botón Rechazar de la notificación (Aceptar abre OfertaActivity). */
class AccionOfertaReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val rideId = intent.getStringExtra("rideId") ?: return
        if (intent.action == RECHAZAR) Ofertas.rechazar(context, rideId)
    }

    companion object {
        const val RECHAZAR = "co.sogataxi.conductor.RECHAZAR"
    }
}
