package co.sogataxi.conductor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent

/**
 * La única pantalla de Android: pinta la app común (`AppConductor`, en
 * `shared`). Las pantallas, la sesión y el turno son los mismos del iPhone.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AppConductor() }
    }
}
