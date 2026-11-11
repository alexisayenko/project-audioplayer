package com.alexisayenko.audioplayer.android.auth

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.alexisayenko.audioplayer.android.data.store.LibraryIndex
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** The claims the app reads from an ID token. The token is not verified here: the server does that on every call. */
data class JwtClaims(val email: String?, val expiresAtMs: Long)

/** Reads `exp` and `email` from a JWT's payload (the iOS `AuthService.claims`). */
object Jwt {
    private val json = Json { ignoreUnknownKeys = true }

    /** Null when the text is not a three-part JWT with a numeric `exp`. */
    fun claims(token: String): JwtClaims? {
        val parts = token.split(".")
        if (parts.size != 3) return null
        return try {
            val payload = Base64.getUrlDecoder().decode(parts[1].trimEnd('='))
            val obj = json.parseToJsonElement(String(payload, Charsets.UTF_8)) as? JsonObject ?: return null
            val exp = (obj["exp"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull ?: return null
            val email = (obj["email"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            JwtClaims(email, (exp * 1000).toLong())
        } catch (_: Exception) {
            null
        }
    }
}

/** What is kept between runs for the signed-in account (AND-073): the ID token, its expiry and the account email. */
@Serializable
data class StoredCredential(val idToken: String, val expiresAtMs: Long, val email: String? = null) {
    /** Never prints the token. */
    override fun toString(): String = "StoredCredential(email=${if (email == null) "none" else "set"}, expiresAtMs=$expiresAtMs)"
}

/** Where the credential is kept. */
interface CredentialStore {
    /** The stored credential, or null when there is none or it cannot be decrypted (a restored backup, a wiped key). */
    fun read(): StoredCredential?
    fun write(credential: StoredCredential)
    fun clear()
}

/** Encrypts and decrypts the credential bytes. The real one is [KeystoreCipher]; tests use a plain JVM key. */
interface TokenCipher {
    /** Returns the IV followed by the ciphertext. */
    fun encrypt(plain: ByteArray): ByteArray
    fun decrypt(sealed: ByteArray): ByteArray
}

/** AES-256-GCM with a random 12-byte IV in front of the ciphertext; the key comes from [key]. */
open class AesGcmCipher(private val key: () -> SecretKey) : TokenCipher {
    override fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun decrypt(sealed: ByteArray): ByteArray {
        require(sealed.size > IV_BYTES) { "too short" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
        return cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}

/** An AES-GCM key that lives in the Android Keystore and never leaves it (AND-073); made on first use. */
class KeystoreCipher(alias: String = "electrophone.credential") : AesGcmCipher({ keystoreKey(alias) }) {
    private companion object {
        const val PROVIDER = "AndroidKeyStore"

        fun keystoreKey(alias: String): SecretKey {
            val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
            (store.getKey(alias, null) as? SecretKey)?.let { return it }
            val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).apply { init(spec) }.generateKey()
        }
    }
}

/**
 * The credential in one file, encrypted with an AES-GCM key from the Android Keystore (AND-073). Jetpack Security's
 * `EncryptedSharedPreferences` is not used. Nothing is logged; a file that cannot be decrypted reads as signed out.
 *
 * @param file where the sealed credential lives; keep it in `noBackupFilesDir`, a backup could not be decrypted on another phone
 */
class TokenStore(private val file: File, private val cipher: TokenCipher = KeystoreCipher()) : CredentialStore {
    private val json = Json { ignoreUnknownKeys = true }

    @Synchronized
    override fun read(): StoredCredential? = try {
        if (!file.exists()) null else json.decodeFromString<StoredCredential>(String(cipher.decrypt(file.readBytes()), Charsets.UTF_8))
    } catch (_: Exception) {
        null
    }

    @Synchronized
    override fun write(credential: StoredCredential) {
        try {
            file.parentFile?.mkdirs()
            val temp = File(file.path + ".tmp")
            FileOutputStream(temp).use { it.write(cipher.encrypt(json.encodeToString(StoredCredential.serializer(), credential).toByteArray())) }
            LibraryIndex.move(temp, file)
        } catch (_: Exception) {
            // The session still works for this run; the person signs in again after a restart.
        }
    }

    @Synchronized
    override fun clear() {
        file.delete()
    }
}
