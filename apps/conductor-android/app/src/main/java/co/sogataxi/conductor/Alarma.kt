package co.sogataxi.conductor

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * El sonido de una oferta: la alarma del teléfono, en bucle, con vibración,
 * hasta que el conductor conteste o la oferta venza.
 *
 * Va por el canal de ALARMA (USAGE_ALARM), no el de notificaciones: suena
 * con el teléfono en silencio de notificaciones y respeta solo el volumen de
 * alarma. Es lo que la PWA no podía hacer.
 */
object Alarma {
    private var reproductor: MediaPlayer? = null
    private var vibrador: Vibrator? = null

    fun sonar(context: Context) {
        if (reproductor != null) return
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        reproductor = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(context, uri)
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { Diagnostico.evento("No pudo sonar la alarma: ${it.message}") }.getOrNull()

        vibrador = if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }
        // Medio segundo vibrando, medio segundo quieto, repetido.
        vibrador?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 500, 500), 1))
    }

    fun callar() {
        reproductor?.runCatching { stop(); release() }
        reproductor = null
        vibrador?.cancel()
        vibrador = null
    }
}
