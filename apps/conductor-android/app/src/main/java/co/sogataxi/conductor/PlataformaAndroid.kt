package co.sogataxi.conductor

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Android: lo que el código común (`shared`) le pide al sistema.
 *
 * Preferencias con el token cifrado por el Keystore, HttpURLConnection, la
 * oferta como notificación de pantalla completa con la alarma del teléfono,
 * y el turno como servicio en primer plano (`TurnoService`).
 */
class PlataformaAndroid(private val app: Context) : Plataforma {
    private val prefs: SharedPreferences = app.getSharedPreferences("sogataxi", Context.MODE_PRIVATE)

    init {
        // La fase 0 guardaba el token en claro: se cifra y se borra el viejo.
        prefs.getString("token", null)?.let { viejo ->
            prefs.edit().putString("tokenCifrado", Cifrado.cifrar(viejo)).remove("token").apply()
        }
        // La fase 0 guardaba aquí la carrera en curso; ahora la dice la API.
        prefs.edit().remove("rideId").apply()
    }

    override val apiBasePorDefecto: String = BuildConfig.API_BASE
    override val apiEditable: Boolean = BuildConfig.API_EDITABLE
    override val depuracion: Boolean = BuildConfig.DEBUG
    override val dispositivo: String = "${Build.MANUFACTURER} ${Build.MODEL}"
    override val sistema: String = "Android ${Build.VERSION.RELEASE}"
    override val versionDeLaApp: Int = BuildConfig.VERSION_CODE

    /* ---------------------------------------------------- almacenamiento */

    override fun leer(clave: String): String? = prefs.getString(clave, null)

    @SuppressLint("ApplySharedPref")
    override fun guardar(clave: String, valor: String?, yaMismo: Boolean) {
        val edicion = prefs.edit().apply { if (valor == null) remove(clave) else putString(clave, valor) }
        // commit() y no apply() para la cola: es lo único que no puede
        // perderse si Android mata el proceso justo después de "Llegué".
        if (yaMismo) edicion.commit() else edicion.apply()
    }

    override fun leerSecreto(): String? = prefs.getString("tokenCifrado", null)?.let { Cifrado.descifrar(it) }

    override fun guardarSecreto(valor: String?) {
        prefs.edit().apply {
            if (valor == null) remove("tokenCifrado") else putString("tokenCifrado", Cifrado.cifrar(valor))
        }.apply()
    }

    override fun uuid(): String = UUID.randomUUID().toString()

    /* --------------------------------------------------------------- red */

    /** HttpURLConnection, que viene con Android: no hace falta más para unos pocos JSON. */
    override suspend fun http(
        metodo: String,
        url: String,
        cabeceras: Map<String, String>,
        cuerpo: String?,
        tiempoMs: Int,
    ): RespuestaHttp = withContext(Dispatchers.IO) {
        val conexion = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = metodo
            connectTimeout = tiempoMs
            readTimeout = tiempoMs
            cabeceras.forEach { (nombre, valor) -> setRequestProperty(nombre, valor) }
            if (cuerpo != null) doOutput = true
        }
        try {
            if (cuerpo != null) conexion.outputStream.use { it.write(cuerpo.toByteArray()) }
            val estado = conexion.responseCode
            val bytes = (if (estado in 200..299) conexion.inputStream else conexion.errorStream)
                ?.use { it.readBytes() } ?: ByteArray(0)
            RespuestaHttp(estado, bytes)
        } catch (e: IOException) {
            throw SinSenal(e)
        } finally {
            conexion.disconnect()
        }
    }

    /* ------------------------------------------------------------- turno */

    override fun tienePermisoDeUbicacion(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    override fun requisitos(): List<Requisito> {
        val pantallaCompleta = Build.VERSION.SDK_INT < 34 ||
            app.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
        val bateria = app.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(app.packageName)
        val paquete = Uri.parse("package:${app.packageName}")
        return listOf(
            Requisito("Ubicación", tienePermisoDeUbicacion()),
            Requisito("Notificaciones", NotificationManagerCompat.from(app).areNotificationsEnabled()),
            Requisito("Ofertas a pantalla completa", pantallaCompleta) {
                if (Build.VERSION.SDK_INT >= 34) {
                    abrirAjuste(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, paquete))
                }
            },
            Requisito("Sin límite de batería", bateria) {
                @SuppressLint("BatteryLife")
                abrirAjuste(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, paquete))
            },
        )
    }

    private fun abrirAjuste(intent: Intent) {
        runCatching { app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { mensajeBreve("Este teléfono no abre ese ajuste: búscalo en Ajustes.") }
    }

    override fun iniciarTurno() = TurnoService.iniciar(app)
    override fun detenerTurno() = TurnoService.detener(app)

    /* ----------------------------------------------------------- ofertas */

    /**
     * Notificación de pantalla completa: despierta el teléfono y se pone
     * encima del bloqueo. Si el conductor está usando el teléfono, Android
     * la muestra como aviso flotante con los botones Aceptar y Rechazar.
     */
    override fun presentarOferta(oferta: OfertaDeCarrera) {
        val abrir = PendingIntent.getActivity(
            app, 0,
            Intent(app, OfertaActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val rechazar = PendingIntent.getBroadcast(
            app, AccionOfertaReceiver.RECHAZAR.hashCode(),
            Intent(app, AccionOfertaReceiver::class.java)
                .setAction(AccionOfertaReceiver.RECHAZAR)
                .putExtra("rideId", oferta.rideId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notificacion = NotificationCompat.Builder(app, App.CANAL_OFERTAS)
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
            .addAction(0, "Rechazar", rechazar)
            // Aceptar abre una actividad directamente: desde Android 12 un
            // botón de notificación no puede pasar por un receptor para luego
            // abrir la app ("trampolín" bloqueado).
            .addAction(
                0, "ACEPTAR",
                PendingIntent.getActivity(
                    app, 1,
                    Intent(app, OfertaActivity::class.java)
                        .setAction(OfertaActivity.ACEPTAR)
                        .putExtra("rideId", oferta.rideId)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
        app.getSystemService(NotificationManager::class.java).notify(NOTIFICACION_OFERTA, notificacion)
    }

    override fun retirarOferta() {
        app.getSystemService(NotificationManager::class.java).cancel(NOTIFICACION_OFERTA)
    }

    override fun sonarAlarma() = Alarma.sonar(app)
    override fun callarAlarma() = Alarma.callar()

    /* ------------------------------------------------------------ avisos */

    override fun avisar(id: Int, titulo: String, texto: String) {
        val puedeAvisar = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!puedeAvisar) {
            Diagnostico.evento("Sin permiso de notificaciones: no se avisó «$titulo»")
            return
        }
        val abrir = PendingIntent.getActivity(
            app, id, Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val aviso = NotificationCompat.Builder(app, App.CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setAutoCancel(true)
            .setContentIntent(abrir)
            .build()
        runCatching { NotificationManagerCompat.from(app).notify(id, aviso) }
            .onFailure { Diagnostico.evento("No se pudo avisar «$titulo»: ${it.message}") }
    }

    override fun quitarAviso(id: Int) {
        runCatching { NotificationManagerCompat.from(app).cancel(id) }
    }

    /* -------------------------------------------------------------- otros */

    /**
     * Abre la app de mapas si está instalada; si no, el navegador. La app de
     * conductores sigue viva detrás: el turno es un servicio en primer plano.
     */
    override fun abrirEnlace(enlace: String) {
        try {
            app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(enlace)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            mensajeBreve("No hay una app para abrir el mapa")
        }
    }

    /** Llamar al cliente: abre el marcador con el número, sin pedir permiso de llamadas. */
    override fun llamar(telefono: String) {
        runCatching {
            app.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$telefono")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure { mensajeBreve("Este teléfono no puede marcar") }
    }

    override fun mensajeBreve(texto: String) {
        Toast.makeText(app, texto, Toast.LENGTH_LONG).show()
    }

    override fun registrar(texto: String) {
        // Por USB: adb logcat -s SogaTaxi. Solo en depuración: los eventos
        // llevan la dirección de recogida y en la versión final cualquier app
        // con acceso al registro la leería.
        if (BuildConfig.DEBUG) android.util.Log.i("SogaTaxi", texto)
    }

    companion object {
        /** El 1 es el turno; el 3 y el 4, los avisos (`Avisos` en el código común). */
        private const val NOTIFICACION_OFERTA = 2
    }
}

/** El botón Rechazar de la notificación (Aceptar abre OfertaActivity). */
class AccionOfertaReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val rideId = intent.getStringExtra("rideId") ?: return
        if (intent.action == RECHAZAR) Ofertas.rechazar(rideId)
    }

    companion object {
        const val RECHAZAR = "co.sogataxi.conductor.RECHAZAR"
    }
}
