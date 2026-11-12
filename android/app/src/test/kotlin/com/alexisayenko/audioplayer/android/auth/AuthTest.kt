package com.alexisayenko.audioplayer.android.auth

import android.app.Activity
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import java.util.Base64
import javax.crypto.KeyGenerator
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthTest {
    private val dir = tempDir("auth")
    private var clock = 1_800_000_000_000L
    private val scope = CoroutineScope(Dispatchers.Unconfined)

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun jwt(payload: String): String {
        val encode = { text: String -> Base64.getUrlEncoder().withoutPadding().encodeToString(text.toByteArray()) }
        return encode("""{"alg":"RS256"}""") + "." + encode(payload) + ".signature"
    }

    private fun token(expiresInMs: Long, email: String? = "a@b.c", mark: String = "") =
        jwt("""{"aud":"web-client","exp":${(clock + expiresInMs) / 1000}${if (email != null) ""","email":"$email"""" else ""},"jti":"$mark"}""")

    private class MemoryStore(var value: StoredCredential? = null) : CredentialStore {
        override fun read(): StoredCredential? = value
        override fun write(credential: StoredCredential) {
            value = credential
        }

        override fun clear() {
            value = null
        }
    }

    private class FakeSource(var interactiveToken: () -> String = { error("no ui") }, var silentToken: () -> String? = { null }) : GoogleTokenSource {
        var silentCalls = 0
        var cleared = 0
        override suspend fun interactive(activity: Activity): String = interactiveToken()
        override suspend fun silent(): String? {
            silentCalls += 1
            return silentToken()
        }

        override suspend fun clear() {
            cleared += 1
        }
    }

    private fun account(source: GoogleTokenSource, store: CredentialStore, clientId: String = "web-client") =
        GoogleAccount(source, store, scope, clientId, now = { clock })

    // The Account interface wants an Activity; the fakes never touch it.
    private val activity: Activity get() = sun.misc.Unsafe::class.java.getDeclaredField("theUnsafe").let {
        it.isAccessible = true
        (it.get(null) as sun.misc.Unsafe).allocateInstance(Activity::class.java) as Activity
    }

    @Test
    fun jwtClaimsAreReadFromThePayload() {
        val claims = Jwt.claims(jwt("""{"exp":1800000000,"email":"alex@example.com","aud":"x"}"""))!!
        assertEquals(1_800_000_000_000L, claims.expiresAtMs)
        assertEquals("alex@example.com", claims.email)
        assertNull(Jwt.claims(jwt("""{"exp":1800000000}"""))!!.email)
        assertEquals(1_800_000_000_500L, Jwt.claims(jwt("""{"exp":1800000000.5}"""))!!.expiresAtMs)
        assertEquals("ü@example.com", Jwt.claims(jwt("""{"exp":1,"email":"ü@example.com"}"""))!!.email)
        assertNull(Jwt.claims(jwt("""{"email":"no exp"}""")))
        assertNull(Jwt.claims(jwt("""{"exp":"soon"}""")))
        assertNull(Jwt.claims("only.two"))
        assertNull(Jwt.claims("a.!!!.c"))
        assertNull(Jwt.claims(""))
        val padded = jwt("""{"exp":5}""").split(".").let { it[0] + "." + it[1] + "==." + it[2] }
        assertEquals(5000L, Jwt.claims(padded)!!.expiresAtMs)
    }

    @Test
    fun theTokenStoreKeepsTheCredentialEncrypted() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val file = File(dir, "credential.bin")
        val store = TokenStore(file, AesGcmCipher { key })
        assertNull(store.read())
        val credential = StoredCredential("header.payload.signature", 123L, "a@b.c")
        store.write(credential)
        assertEquals(credential, store.read())
        val raw = String(file.readBytes(), Charsets.ISO_8859_1)
        assertFalse(raw.contains("payload"))
        assertFalse(raw.contains("a@b.c"))
        assertFalse(credential.toString().contains("payload"))

        val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        assertNull("another key (a restored backup) reads as signed out", TokenStore(file, AesGcmCipher { other }).read())
        file.writeBytes(byteArrayOf(1, 2, 3))
        assertNull(store.read())
        store.write(credential)
        store.clear()
        assertNull(store.read())
        assertFalse(file.exists())
    }

    @Test
    fun withoutAClientIdSignInSaysSoInsteadOfCrashing() = runBlocking {
        val account = account(FakeSource(), MemoryStore(), clientId = "")
        account.signInWithGoogle(activity)
        assertEquals("Google sign-in is not configured in this build.", account.error.value)
        assertNull(account.session.value)
        assertFalse(account.busy.value)
        assertNull(account.validToken())
    }

    @Test
    fun signInStoresTheCredentialAndASecondLaunchRestoresIt() = runBlocking {
        val store = MemoryStore()
        val fresh = token(3_600_000)
        val account = account(FakeSource(interactiveToken = { fresh }), store)
        assertNull(account.session.value)
        account.signInWithGoogle(activity)
        assertEquals("a@b.c", account.session.value?.email)
        assertEquals(fresh, account.validToken())
        assertEquals(fresh, store.value?.idToken)
        assertNull(account.error.value)

        val relaunched = account(FakeSource(), store)
        assertEquals("a@b.c", relaunched.session.value?.email)
        assertEquals(fresh, relaunched.validToken())

        relaunched.signOut()
        assertNull(relaunched.session.value)
        assertNull(store.value)
        assertNull(relaunched.validToken())
    }

    @Test
    fun theInteractiveSignInFallsBackToTheButtonFlowWhenTheChooserFindsNoCredential() = runBlocking {
        val logged = mutableListOf<String>()
        val log = { attempt: String, e: Exception -> logged += "$attempt ${e.javaClass.simpleName}"; Unit }
        assertEquals("first", interactiveToken({ "first" }, { error("not asked") }, log))
        assertEquals("second", interactiveToken({ throw NoCredentialException("none") }, { "second" }, log))
        assertEquals(listOf("GetGoogleIdOption NoCredentialException"), logged)
        assertTrue(runCatching { interactiveToken({ throw NoCredentialException() }, { throw NoCredentialException() }, log) }.exceptionOrNull() is NoGoogleAccount)
        assertEquals(3, logged.size)
        assertTrue(runCatching { interactiveToken({ throw NoCredentialException() }, { throw GetCredentialCancellationException() }, log) }.exceptionOrNull() is SignInCancelled)
        assertTrue(runCatching { interactiveToken({ throw GetCredentialCancellationException() }, { "unused" }, log) }.exceptionOrNull() is SignInCancelled)
        val cancelled = runCatching { interactiveToken({ throw NoCredentialException() }, { throw GetCredentialCancellationException("[16] Account reauth failed") }, log) }.exceptionOrNull()
        assertEquals("(GetCredentialCancellationException: [16] Account reauth failed) at GetSignInWithGoogleOption", (cancelled as SignInCancelled).detail)
        val failed = runCatching { interactiveToken({ throw IllegalStateException("odd") }, { "unused" }, log) }.exceptionOrNull()
        assertEquals("(IllegalStateException: odd) at GetGoogleIdOption", (failed as SignInFailed).detail)
    }

    @Test
    fun everySignInFailureIsShownWithItsCause() = runBlocking {
        val source = FakeSource(interactiveToken = { throw SignInCancelled() })
        val account = account(source, MemoryStore())
        account.signInWithGoogle(activity)
        assertEquals("Sign-in was cancelled", account.error.value)
        source.interactiveToken = { throw SignInCancelled("(GetCredentialCancellationException: [16] Account reauth failed) at GetGoogleIdOption") }
        account.signInWithGoogle(activity)
        assertEquals("Sign-in was cancelled (GetCredentialCancellationException: [16] Account reauth failed) at GetGoogleIdOption", account.error.value)
        source.interactiveToken = { throw NoGoogleAccount("(NoCredentialException: none) at GetSignInWithGoogleOption") }
        account.signInWithGoogle(activity)
        assertTrue(account.error.value!!.startsWith("No Google account"))
        assertTrue(account.error.value!!.endsWith("try again. (NoCredentialException: none) at GetSignInWithGoogleOption"))
        source.interactiveToken = { throw SignInFailed("(IllegalStateException: odd) at GetGoogleIdOption") }
        account.signInWithGoogle(activity)
        assertEquals("Google sign-in failed. Try again. (IllegalStateException: odd) at GetGoogleIdOption", account.error.value)
        source.interactiveToken = { throw IllegalArgumentException("bad") }
        account.signInWithGoogle(activity)
        assertEquals("Google sign-in failed. Try again. (IllegalArgumentException: bad)", account.error.value)
        source.interactiveToken = { "not a jwt" }
        account.signInWithGoogle(activity)
        assertEquals("Google sign-in failed. Try again. (token unparseable)", account.error.value)
        source.interactiveToken = { token(-60_000) }
        account.signInWithGoogle(activity)
        assertEquals("Google sign-in failed. Try again. (token expired)", account.error.value)
        assertNull(account.session.value)
        assertFalse(account.busy.value)
    }

    @Test
    fun theSignInRunsInTheAppScopeAndReturnsAtOnce() {
        val gate = CompletableDeferred<String>()
        val source = object : GoogleTokenSource {
            override suspend fun interactive(activity: Activity): String = gate.await()
            override suspend fun silent(): String? = null
            override suspend fun clear() = Unit
        }
        val account = account(source, MemoryStore())
        account.signInWithGoogle(activity)
        assertTrue(account.busy.value)
        gate.complete(token(3_600_000))
        assertEquals("a@b.c", account.session.value?.email)
        assertFalse(account.busy.value)
    }

    @Test
    fun aTokenCloseToExpiryIsRenewedSilently() = runBlocking {
        val old = token(3_600_000, mark = "old")
        val store = MemoryStore(StoredCredential(old, clock + 3_600_000, "a@b.c"))
        val source = FakeSource()
        val account = account(source, store)
        assertEquals(old, account.validToken())
        assertEquals(0, source.silentCalls)

        clock += 3_600_000 - 4 * 60_000
        val renewed = token(3_600_000, email = null, mark = "new")
        source.silentToken = { renewed }
        assertEquals(renewed, account.validToken())
        assertEquals(1, source.silentCalls)
        assertEquals(renewed, store.value?.idToken)
        assertEquals("the email is kept when the new token has none", "a@b.c", account.session.value?.email)
        assertEquals(renewed, account.validToken())
        assertEquals(1, source.silentCalls)
    }

    @Test
    fun whenSilentRenewalFailsTheOldTokenServesUntilItExpiresThenSignInIsNeeded() = runBlocking {
        val old = token(3_600_000)
        val source = FakeSource()
        val account = account(source, MemoryStore(StoredCredential(old, clock + 3_600_000, "a@b.c")))
        clock += 3_600_000 - 2 * 60_000
        assertEquals(old, account.validToken())
        assertEquals(old, account.validToken())
        assertEquals("a failing renewal is not repeated on every call", 1, source.silentCalls)
        assertNull(account.error.value)

        clock += 3 * 60_000
        assertNull(account.validToken())
        assertEquals("Expired, sign in again", account.error.value)
        assertTrue(account.session.value!!.expired(clock))
        assertEquals(2, source.silentCalls)

        clock += 61_000
        val renewed = token(3_600_000)
        source.silentToken = { renewed }
        assertEquals(renewed, account.validToken())
        assertNull(account.error.value)
        assertFalse(account.session.value!!.expired(clock))
    }
}
