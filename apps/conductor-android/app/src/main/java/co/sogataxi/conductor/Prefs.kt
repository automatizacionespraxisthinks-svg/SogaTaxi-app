package co.sogataxi.conductor

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/**
 * Lo poco que la app guarda en el teléfono: a qué API habla, el token del
 * conductor, su identificador de instalación y la carrera en curso.
 *
 * FASE 0: el token va en SharedPreferences privadas. Para producción pasa a
 * EncryptedSharedPreferences o al Keystore.
 */
object Prefs {
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("sogataxi", Context.MODE_PRIVATE)
    }

    /** La API de desarrollo en la red local; se puede cambiar en el acceso. */
    var apiBase: String
        get() = prefs.getString("apiBase", null) ?: "http://192.168.1.3:3000"
        set(value) = prefs.edit().putString("apiBase", value.trimEnd('/')).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().putString("token", value).apply()

    var conductor: String?
        get() = prefs.getString("conductor", null)
        set(value) = prefs.edit().putString("conductor", value).apply()

    var codigo: String?
        get() = prefs.getString("codigo", null)
        set(value) = prefs.edit().putString("codigo", value).apply()

    var placa: String?
        get() = prefs.getString("placa", null)
        set(value) = prefs.edit().putString("placa", value).apply()

    /** La carrera aceptada en este teléfono; va en cada posición mientras dure. */
    var rideId: String?
        get() = prefs.getString("rideId", null)
        set(value) = prefs.edit().putString("rideId", value).apply()

    /**
     * El mismo papel que `install` en la PWA: volver a entrar desde este
     * teléfono no crea otro dispositivo en la API.
     */
    val installId: String
        get() = prefs.getString("installId", null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString("installId", it).apply() }

    fun salir() {
        prefs.edit().remove("token").remove("conductor").remove("codigo").remove("placa").remove("rideId").apply()
    }
}
