package co.sogataxi.conductor

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/**
 * Lo que la app guarda en el teléfono: a qué API habla, el token del
 * conductor (cifrado con el Keystore), su identificador de instalación, lo
 * último que se supo de la sesión y la cola de etapas sin enviar.
 */
object Prefs {
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("sogataxi", Context.MODE_PRIVATE)
        // La fase 0 guardaba el token en claro: se cifra y se borra el viejo.
        prefs.getString("token", null)?.let { viejo ->
            prefs.edit().putString("tokenCifrado", Cifrado.cifrar(viejo)).remove("token").apply()
        }
        // La fase 0 guardaba aquí la carrera en curso; ahora la dice la API.
        prefs.edit().remove("rideId").apply()
    }

    /**
     * La API. En la versión de depuración se puede cambiar en el acceso (la
     * de la red local); en la final es la de producción, por HTTPS, fija.
     */
    var apiBase: String
        get() = if (BuildConfig.API_EDITABLE) prefs.getString("apiBase", null) ?: BuildConfig.API_BASE else BuildConfig.API_BASE
        set(value) {
            if (BuildConfig.API_EDITABLE) prefs.edit().putString("apiBase", value.trim().trimEnd('/')).apply()
        }

    var token: String?
        get() = prefs.getString("tokenCifrado", null)?.let { Cifrado.descifrar(it) }
        set(value) = prefs.edit().apply {
            if (value == null) remove("tokenCifrado") else putString("tokenCifrado", Cifrado.cifrar(value))
        }.apply()

    var conductor: String?
        get() = prefs.getString("conductor", null)
        set(value) = prefs.edit().putString("conductor", value).apply()

    var codigo: String?
        get() = prefs.getString("codigo", null)
        set(value) = prefs.edit().putString("codigo", value).apply()

    /** La placa del último turno: se ofrece al abrir el siguiente. */
    var placa: String?
        get() = prefs.getString("placa", null)
        set(value) = prefs.edit().putString("placa", value).apply()

    /** Lo último que se supo de la sesión (JSON), para abrir sin señal donde estaba. */
    var ultimoEstado: String?
        get() = prefs.getString("ultimoEstado", null)
        set(value) = prefs.edit().putString("ultimoEstado", value).apply()

    /** La cola de etapas sin enviar (JSON), ver `Cola`. */
    var cola: String?
        get() = prefs.getString("cola", null)
        set(value) = prefs.edit().putString("cola", value).apply()

    /**
     * El mismo papel que `install` en la PWA: volver a entrar desde este
     * teléfono no crea otro dispositivo en la API.
     */
    val installId: String
        get() = prefs.getString("installId", null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString("installId", it).apply() }

    /** Cerrar la sesión de este celular. La placa se recuerda para el próximo. */
    fun salir() {
        prefs.edit()
            .remove("tokenCifrado").remove("conductor").remove("codigo")
            .remove("ultimoEstado").remove("cola")
            .apply()
    }
}
