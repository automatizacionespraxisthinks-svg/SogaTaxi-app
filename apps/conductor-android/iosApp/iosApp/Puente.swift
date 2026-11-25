import Foundation
import Security
import Conductor

/// Lo que el código común le pide a Swift: el Llavero y el socket.
final class Puente: NSObject, PuenteIos {
    private let servicio = "co.sogataxi.conductor"
    private let cuenta = "token"

    private var consulta: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: servicio,
            kSecAttrAccount as String: cuenta,
        ]
    }

    /// El token del conductor. En el Llavero no sale del teléfono ni va a los
    /// respaldos de iCloud (`ThisDeviceOnly`), y se puede leer con la pantalla
    /// bloqueada después del primer desbloqueo, que es cuando corre el turno.
    func leerSecreto() -> String? {
        var buscar = consulta
        buscar[kSecReturnData as String] = true
        buscar[kSecMatchLimit as String] = kSecMatchLimitOne
        var resultado: AnyObject?
        guard SecItemCopyMatching(buscar as CFDictionary, &resultado) == errSecSuccess,
              let datos = resultado as? Data else { return nil }
        return String(data: datos, encoding: .utf8)
    }

    func guardarSecreto(valor: String?) {
        SecItemDelete(consulta as CFDictionary)
        guard let valor = valor, let datos = valor.data(using: .utf8) else { return }
        var nuevo = consulta
        nuevo[kSecValueData as String] = datos
        nuevo[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(nuevo as CFDictionary, nil)
    }

    func crearTiempoReal() -> TiempoReal {
        SocketTiempoReal()
    }
}
