import Foundation
import SocketIO
import Conductor

/// El socket `/rt` de la API (socket.io 4), el mismo de la PWA y de Android.
/// Qué se hace con cada evento lo decide el motor común (`MotorDeTurno`).
final class SocketTiempoReal: NSObject, TiempoReal {
    private var gestor: SocketManager?
    private var socket: SocketIOClient?

    func conectar(url: String, token: String, eventos: [String], oyente: OyenteTiempoReal) {
        desconectar()

        // Llega «https://api…/rt»: el servidor es lo de delante y «/rt» el
        // espacio de nombres.
        guard var partes = URLComponents(string: url) else { return }
        let espacio = partes.path.isEmpty ? "/" : partes.path
        partes.path = ""
        guard let servidor = partes.url else { return }

        let gestor = SocketManager(
            socketURL: servidor,
            config: [.reconnects(true), .reconnectWait(1), .reconnectWaitMax(10), .log(false)]
        )
        let socket = gestor.socket(forNamespace: espacio)

        socket.on(clientEvent: .connect) { _, _ in oyente.conectado() }
        socket.on(clientEvent: .disconnect) { _, _ in oyente.desconectado() }
        socket.on(clientEvent: .error) { _, _ in oyente.desconectado() }
        // Con reconexión automática, una caída (sin cobertura) no llega como
        // `.disconnect` sino como `.reconnect`: sin esto la cabecera seguiría
        // diciendo «En vivo» con el socket caído.
        socket.on(clientEvent: .reconnect) { _, _ in oyente.desconectado() }
        for nombre in eventos {
            socket.on(nombre) { datos, _ in
                oyente.evento(nombre: nombre, json: SocketTiempoReal.comoJson(datos.first))
            }
        }

        // El token va en `auth`, como en la PWA; la librería lo repite al reconectar.
        socket.connect(withPayload: ["token": token])
        self.gestor = gestor
        self.socket = socket
    }

    func desconectar() {
        socket?.removeAllHandlers()
        socket?.disconnect()
        gestor?.disconnect()
        socket = nil
        gestor = nil
    }

    /// El primer argumento del evento, como texto JSON, o nulo.
    private static func comoJson(_ dato: Any?) -> String? {
        guard let dato = dato, JSONSerialization.isValidJSONObject(dato),
              let datos = try? JSONSerialization.data(withJSONObject: dato) else { return nil }
        return String(data: datos, encoding: .utf8)
    }
}
