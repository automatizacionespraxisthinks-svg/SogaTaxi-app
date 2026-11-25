package co.sogataxi.conductor

/**
 * Lo que la app guarda en el teléfono: a qué API habla, el token del
 * conductor (cifrado por el sistema), su identificador de instalación, lo
 * último que se supo de la sesión y la cola de etapas sin enviar.
 *
 * Las claves son las mismas de la app Android anterior: al actualizar, el
 * conductor sigue con su sesión.
 */
object Prefs {
    /**
     * La API. En la versión de depuración se puede cambiar en el acceso (la
     * de la red local); en la final es la de producción, por HTTPS, fija.
     */
    var apiBase: String
        get() = if (plataforma.apiEditable) {
            plataforma.leer("apiBase") ?: plataforma.apiBasePorDefecto
        } else {
            plataforma.apiBasePorDefecto
        }
        set(value) {
            if (plataforma.apiEditable) plataforma.guardar("apiBase", value.trim().trimEnd('/'))
        }

    var token: String?
        get() = plataforma.leerSecreto()
        set(value) = plataforma.guardarSecreto(value)

    var conductor: String?
        get() = plataforma.leer("conductor")
        set(value) = plataforma.guardar("conductor", value)

    var codigo: String?
        get() = plataforma.leer("codigo")
        set(value) = plataforma.guardar("codigo", value)

    /** La placa del último turno: se ofrece al abrir el siguiente. */
    var placa: String?
        get() = plataforma.leer("placa")
        set(value) = plataforma.guardar("placa", value)

    /** Lo último que se supo de la sesión (JSON), para abrir sin señal donde estaba. */
    var ultimoEstado: String?
        get() = plataforma.leer("ultimoEstado")
        set(value) = plataforma.guardar("ultimoEstado", value)

    /**
     * La cola de etapas sin enviar (JSON), ver `Cola`. Es lo único que no
     * puede perderse si el sistema mata el proceso justo después de «Llegué»
     * sin señal: se escribe en el disco antes de volver.
     */
    var cola: String?
        get() = plataforma.leer("cola")
        set(value) = plataforma.guardar("cola", value, yaMismo = true)

    /**
     * El mismo papel que `install` en la PWA: volver a entrar desde este
     * teléfono no crea otro dispositivo en la API.
     */
    val installId: String
        get() = plataforma.leer("installId")
            ?: plataforma.uuid().also { plataforma.guardar("installId", it) }

    /**
     * Cerrar la sesión de este celular. La placa se recuerda para el próximo.
     *
     * La cola NO se borra: cada etapa lleva su dueño (`Cola`), así que otro
     * conductor no la envía, y si la oficina cerró la sesión con un «Llegué»
     * sin enviar, sale cuando ese conductor vuelva a entrar.
     */
    fun salir() {
        plataforma.guardarSecreto(null)
        plataforma.guardar("conductor", null)
        plataforma.guardar("codigo", null)
        plataforma.guardar("ultimoEstado", null)
    }
}
