package co.sogataxi.conductor

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * El sonido de una oferta: el de SogaTaxi («pi-pi» de bocina y una
 * campanita, `res/raw/oferta_sogataxi.wav`, hecho con
 * `apps/driver/scripts/generar-sonido.mjs`), en bucle, con vibración, hasta
 * que el conductor conteste o la oferta venza. Si el archivo fallara, suena
 * la alarma del teléfono.
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
        val propio = Uri.parse("android.resource://${context.packageName}/${R.raw.oferta_sogataxi}")
        val delTelefono = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        reproductor = reproducir(context, propio) ?: delTelefono?.let { reproducir(context, it) }

        vibrador = if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }
        // Al ritmo del sonido: dos golpes cortos (la bocina) y uno largo, cada 2,4 s.
        vibrador?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 160, 100, 300, 400, 700, 740), 0))
    }

    private fun reproducir(context: Context, uri: Uri): MediaPlayer? =
        runCatching {
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
        }.onFailure { Diagnostico.evento("No pudo sonar $uri: ${it.message}") }.getOrNull()

    fun callar() {
        reproductor?.runCatching { stop(); release() }
        reproductor = null
        vibrador?.cancel()
        vibrador = null
    }
}
