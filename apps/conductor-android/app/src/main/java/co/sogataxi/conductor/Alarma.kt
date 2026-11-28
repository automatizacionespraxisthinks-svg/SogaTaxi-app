package co.sogataxi.conductor

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * El sonido de una oferta: el de SogaTaxi («pi-pi» de bocina y una
 * campanita, `res/raw/oferta_sogataxi.wav`, hecho con
 * `apps/driver/scripts/generar-sonido.mjs`), con vibración, durante tres
 * segundos (28/11/2026; fueron dos desde el 26/11). Si el archivo fallara, suena la alarma del teléfono.
 *
 * Hasta el 26/11/2026 sonaba en bucle hasta que el conductor contestara o la
 * oferta venciera; con tantas carreras llegando, cansaba. La oferta sigue en
 * pantalla después de callarse.
 *
 * Va por el canal de ALARMA (USAGE_ALARM), no el de notificaciones: suena
 * con el teléfono en silencio de notificaciones y respeta solo el volumen de
 * alarma. Es lo que la PWA no podía hacer.
 */
object Alarma {
    private var reproductor: MediaPlayer? = null
    private var vibrador: Vibrator? = null

    /** Cuánto suena y vibra cada oferta. */
    private const val DURACION_MS = 3_000L
    private val reloj = Handler(Looper.getMainLooper())
    private val alVencer = Runnable { callar() }

    fun sonar(context: Context) {
        if (reproductor != null) return
        reloj.removeCallbacks(alVencer)
        val propio = Uri.parse("android.resource://${context.packageName}/${R.raw.oferta_sogataxi}")
        val delTelefono = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        // El sonido propio dura lo justo y suena una vez; el del teléfono, en
        // bucle hasta que el reloj lo calle.
        reproductor = reproducir(context, propio, enBucle = false)
            ?: delTelefono?.let { reproducir(context, it, enBucle = true) }

        vibrador = if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }
        // Al ritmo del sonido: los dos «pi-pi» de la bocina y un golpe largo. Una sola vez.
        vibrador?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 160, 100, 300, 320, 160, 100, 300, 220, 900), -1))
        reloj.postDelayed(alVencer, DURACION_MS)
    }

    private fun reproducir(context: Context, uri: Uri, enBucle: Boolean): MediaPlayer? =
        runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(context, uri)
                isLooping = enBucle
                prepare()
                start()
            }
        }.onFailure { Diagnostico.evento("No pudo sonar $uri: ${it.message}") }.getOrNull()

    fun callar() {
        reloj.removeCallbacks(alVencer)
        reproductor?.runCatching { stop(); release() }
        reproductor = null
        vibrador?.cancel()
        vibrador = null
    }
}
