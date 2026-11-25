package co.sogataxi.conductor

import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Lo que comparten Android y iPhone y se puede comprobar sin teléfono:
 * enlaces de mapas, lectura del JSON de la API y de lo guardado por la app
 * Android anterior, distancias y formatos.
 */
class ComunTest {
    private fun objeto(texto: String) = analizarJson(texto) as JsonObject

    /* ------------------------------------------------------------- mapas */

    @Test
    fun aceptaSoloEnlacesDeMapasConocidos() {
        assertNotNull(Mapas.enlaceValido("https://maps.app.goo.gl/abc123"))
        assertNotNull(Mapas.enlaceValido("https://www.google.com/maps/place/x"))
        assertNotNull(Mapas.enlaceValido(" https://waze.com/ul?ll=5.7,-72.9 "))
        assertNull(Mapas.enlaceValido("https://www.google.com/search?q=x"))
        assertNull(Mapas.enlaceValido("https://goo.gl/otra-cosa"))
        assertNull(Mapas.enlaceValido("https://malo.example/maps"))
        assertNull(Mapas.enlaceValido("javascript:alert(1)"))
        assertNull(Mapas.enlaceValido(null))
    }

    @Test
    fun unUsuarioDelanteNoDisfrazaElHost() {
        // El host real es malo.example; google.com es solo el «usuario».
        assertNull(Mapas.enlaceValido("https://www.google.com@malo.example/maps"))
        assertNull(Mapas.enlaceValido("https://www.google.com:443@malo.example/maps"))
        assertNotNull(Mapas.enlaceValido("https://www.google.com:443/maps/x"))
    }

    @Test
    fun conPuntoVaAlMetroExacto() {
        val enlaces = Mapas.enlaces(Carrera("r1", "C-1", "Calle 12 # 10-20", lat = 5.7148, lng = -72.9279))!!
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=5.7148,-72.9279&travelmode=driving", enlaces.maps)
        assertEquals("https://waze.com/ul?ll=5.7148,-72.9279&navigate=yes", enlaces.waze)
    }

    @Test
    fun sinPuntoBuscaLaDireccionConElPueblo() {
        val enlaces = Mapas.enlaces(Carrera("r1", "C-1", "Calle 12 # 10-20 "))!!
        assertEquals(
            "https://waze.com/ul?q=Calle+12+%23+10-20%2C+Sogamoso%2C+Boyac%C3%A1%2C+Colombia&navigate=yes",
            enlaces.waze,
        )
        assertNull(Mapas.enlaces(Carrera("r1", "C-1", "  ")))
    }

    /* -------------------------------------------------------------- JSON */

    @Test
    fun leeLaCarreraDeLaApi() {
        val carrera = Carrera.deJson(
            objeto(
                """{"id":"r1","code":"C-7","pickupText":"Plaza","pickupReference":null,
                   "pickupLat":5.71,"pickupLng":-72.92,"passengers":3,"pagoElectronico":true,
                   "startedAt":"2026-11-25T14:03:00.000Z","customerPhone":"3001234567","notes":""}""",
            ),
        )
        assertEquals("r1", carrera.rideId)
        assertNull(carrera.referencia)
        assertNull(carrera.notas)
        assertEquals(3, carrera.pasajeros)
        assertTrue(carrera.pagoElectronico)
        assertTrue(carrera.tienePunto)
        assertEquals(1795615380000, carrera.abordoDesde)
    }

    @Test
    fun unaCarreraSinUbicarNoTienePunto() {
        val carrera = Carrera.deJson(
            objeto("""{"id":"r1","pickupText":"Vereda","pickupSource":"sin_ubicar","pickupLat":5.71,"pickupLng":-72.92}"""),
        )
        assertFalse(carrera.tienePunto)
        assertEquals(1, carrera.pasajeros)
    }

    @Test
    fun abreLoQueGuardoLaAppAndroidAnterior() {
        // Tal como lo escribía org.json: lo nulo no aparece.
        val guardado = objeto(
            """{"fase":"CARRERA","estadoCarrera":"DRIVER_ARRIVED","carrera":{"id":"r9","code":"C-9",
               "pickupText":"Cra 11","pagoElectronico":false,"passengers":1,"startedAtMs":1795615380000},
               "turnoDesde":1795610000000,"placa":"ABC123","carrerasHoy":4,"radioLlegada":150}""",
        )
        val estado = EstadoSesion.deJson(guardado)
        assertEquals(Fase.CARRERA, estado.fase)
        assertEquals(EstadoCarrera.DRIVER_ARRIVED, estado.estadoCarrera)
        assertEquals("r9", estado.carrera?.rideId)
        assertEquals(1795615380000, estado.carrera?.abordoDesde)
        assertEquals("ABC123", estado.placa)
        assertEquals(4, estado.carrerasHoy)
        assertNull(estado.minutosMinimos)
    }

    @Test
    fun elEstadoVaYVuelveIgual() {
        val estado = EstadoSesion(
            fase = Fase.CARRERA,
            estadoCarrera = EstadoCarrera.IN_PROGRESS,
            carrera = Carrera("r1", "C-1", "Plaza", referencia = "Casa azul", lat = 5.7, lng = -72.9, abordoDesde = 123L),
            turnoDesde = 100L,
            placa = "XYZ987",
            carrerasHoy = 2,
            minutosMinimos = 3,
        )
        val vuelta = EstadoSesion.deJson(objeto(estado.aJson().toString()))
        assertEquals(estado, vuelta)
        // El resumen no se guarda: al abrir de nuevo está disponible.
        assertEquals(Fase.DISPONIBLE, EstadoSesion.deJson(objeto(estado.copy(fase = Fase.RESUMEN).aJson().toString())).fase)
    }

    @Test
    fun unaOfertaSinFechaVenceEnUnRato() {
        val oferta = OfertaDeCarrera.deJson(
            objeto("""{"rideId":"r1","code":"C-1","pickupText":"Plaza","pickupReference":null,"distanceKm":1.25,"etaMinutes":4}"""),
        )
        assertNull(oferta.referencia)
        assertEquals(4, oferta.etaMin)
        assertTrue(oferta.venceEn > ahoraMs())
    }

    @Test
    fun loQueNoEsJsonNoTumbaNada() {
        assertNull(analizarJson(""))
        assertNull(analizarJson("<html>502 Bad Gateway</html>"))
    }

    /* -------------------------------------------------------- versión nueva */

    @Test
    fun avisaSoloSiLaPublicadaEsMasNueva() {
        val enlace = "https://conductor.sogataxi.co/app.apk"
        assertNull(Actualizacion.decidir(instalada = 3, publicada = 3, minima = null, nombre = null, enlace = enlace))
        assertNull(Actualizacion.decidir(instalada = 4, publicada = 3, minima = null, nombre = null, enlace = enlace))
        assertNull(Actualizacion.decidir(instalada = 3, publicada = null, minima = null, nombre = null, enlace = null))
        val nueva = Actualizacion.decidir(instalada = 3, publicada = 5, minima = null, nombre = "1.2.0", enlace = enlace)!!
        assertEquals(enlace, nueva.enlace)
        assertFalse(nueva.obligatoria)
    }

    @Test
    fun esObligatoriaPorDebajoDeLaMinima() {
        val enlace = "https://conductor.sogataxi.co/app.apk"
        assertTrue(Actualizacion.decidir(3, publicada = 5, minima = 4, nombre = null, enlace = enlace)!!.obligatoria)
        assertFalse(Actualizacion.decidir(4, publicada = 5, minima = 4, nombre = null, enlace = enlace)!!.obligatoria)
    }

    @Test
    fun soloAbreEnlacesWeb() {
        assertNull(Actualizacion.decidir(3, publicada = 5, minima = null, nombre = null, enlace = "intent://malo"))
        assertNull(Actualizacion.decidir(3, publicada = 5, minima = null, nombre = null, enlace = "file:///sdcard/x.apk"))
    }

    /* ------------------------------------------------- distancia y formato */

    @Test
    fun midePocosMetrosYVariosKilometros() {
        // Un milésimo de grado de latitud son unos 111 m.
        val cerca = metrosEntre(5.7148, -72.9279, 5.7158, -72.9279)
        assertTrue(cerca in 110f..112.5f, "fueron $cerca m")
        // De la plaza de Sogamoso a la de Paipa hay unos 21 km en línea recta.
        val lejos = metrosEntre(5.7148, -72.9279, 5.7797, -73.1175)
        assertTrue(lejos in 20_000f..23_000f, "fueron $lejos m")
        assertEquals(0f, metrosEntre(5.7, -72.9, 5.7, -72.9))
    }

    @Test
    fun formatos() {
        assertEquals("1,2", unDecimal(1.2))
        assertEquals("1,3", unDecimal(1.25))
        assertEquals("0,0", unDecimal(0.04))
        assertEquals("12,0", unDecimal(12.0))
        assertEquals("05", dosDigitos(5))
        assertEquals("59", dosDigitos(59))
    }

    @Test
    fun fechasDeLaApi() {
        assertEquals(1795615380000, instanteMs("2026-11-25T14:03:00.000Z"))
        assertNull(instanteMs("mañana"))
        assertNull(instanteMs(null))
    }
}
