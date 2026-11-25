import SwiftUI
import Conductor

/// La app de iPhone. Todo lo que se ve y lo que hace viene del código común
/// (`shared`, Kotlin Multiplatform): aquí solo se arranca y se pone en la
/// ventana.
@main
struct SogaTaxiApp: App {
    @UIApplicationDelegateAdaptor(Delegado.self) private var delegado

    init() {
        #if DEBUG
        let depuracion = true
        #else
        let depuracion = false
        #endif
        let apiBase = Bundle.main.object(forInfoDictionaryKey: "API_BASE") as? String ?? ""
        ArranqueKt.iniciarConductor(
            puente: Puente(),
            apiBase: apiBase,
            apiEditable: depuracion,
            depuracion: depuracion
        )
    }

    var body: some Scene {
        WindowGroup {
            // De borde a borde: las pantallas comunes ya dejan el hueco de la
            // barra de estado, del teclado y de la barra inferior.
            Pantalla().ignoresSafeArea()
        }
    }
}

final class Delegado: NSObject, UIApplicationDelegate {
    /// iOS cierra la app con el turno abierto: se le avisa al conductor.
    func applicationWillTerminate(_ application: UIApplication) {
        ArranqueKt.alCerrarLaApp()
    }
}

private struct Pantalla: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        ArranqueKt.vistaPrincipal()
    }

    func updateUIViewController(_ controlador: UIViewController, context: Context) {}
}
