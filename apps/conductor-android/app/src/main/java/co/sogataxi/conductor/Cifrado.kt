package co.sogataxi.conductor

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cifra el token del conductor con una llave del Keystore de Android.
 *
 * La llave nunca sale del hardware del teléfono: aunque alguien copie los
 * archivos de la app (un respaldo, un teléfono con root), el token cifrado no
 * le sirve en otro celular. AES-GCM, con el IV delante del texto cifrado.
 */
object Cifrado {
    private const val ALIAS = "sogataxi-token"
    private const val PROVEEDOR = "AndroidKeyStore"
    private const val TRANSFORMACION = "AES/GCM/NoPadding"

    private fun llave(): SecretKey {
        val almacen = KeyStore.getInstance(PROVEEDOR).apply { load(null) }
        (almacen.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVEEDOR).apply {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    fun cifrar(texto: String): String {
        val cifrador = Cipher.getInstance(TRANSFORMACION).apply { init(Cipher.ENCRYPT_MODE, llave()) }
        val datos = cifrador.iv + cifrador.doFinal(texto.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(datos, Base64.NO_WRAP)
    }

    /** Nulo si no se puede descifrar (llave borrada, datos dañados): se vuelve a entrar. */
    fun descifrar(guardado: String): String? = runCatching {
        val datos = Base64.decode(guardado, Base64.NO_WRAP)
        val cifrador = Cipher.getInstance(TRANSFORMACION).apply {
            init(Cipher.DECRYPT_MODE, llave(), GCMParameterSpec(128, datos, 0, 12))
        }
        String(cifrador.doFinal(datos, 12, datos.size - 12), Charsets.UTF_8)
    }.getOrNull()
}
