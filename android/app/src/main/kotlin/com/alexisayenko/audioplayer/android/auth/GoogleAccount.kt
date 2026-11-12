package com.alexisayenko.audioplayer.android.auth

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialOption
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.alexisayenko.audioplayer.android.BuildConfig
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.lang.ref.WeakReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Google reported the sign-in as cancelled: the person closed the account chooser, or Google refused the request. [detail] says which. */
class SignInCancelled(val detail: String? = null) : Exception("Sign-in cancelled")

/** The phone has no Google account that can sign in. */
class NoGoogleAccount(val detail: String? = null) : Exception("No Google account")

/** Any other failure of the interactive sign-in. */
class SignInFailed(val detail: String? = null) : Exception("Sign-in failed")

internal fun failureDetail(e: Throwable, attempt: String? = null): String =
    "(${e.javaClass.simpleName}: ${e.message})" + if (attempt != null) " at $attempt" else ""

/** Asks Google for an ID token. The real one is [CredentialManagerGoogle]; tests use a fake. */
interface GoogleTokenSource {
    /** Shows the account chooser on [activity] and returns the ID token. Throws [SignInCancelled], [NoGoogleAccount] or [SignInFailed]. */
    suspend fun interactive(activity: Activity): String

    /** A fresh ID token for the account that already signed in, without the person choosing anything; null when that is not possible. */
    suspend fun silent(): String?

    /** Tells the system the person signed out, so the next sign-in shows the chooser again. */
    suspend fun clear()
}

/**
 * Google ID tokens through Credential Manager (AND-070): `GetGoogleIdOption` with `serverClientId` = the web client id, so
 * the token's `aud` is the one the server already accepts. The silent request uses `filterByAuthorizedAccounts = true` and
 * `autoSelectEnabled = true` (AND-072).
 */
class CredentialManagerGoogle(context: Context, private val clientId: String) : GoogleTokenSource {
    private val app = context.applicationContext
    private val manager by lazy { CredentialManager.create(app) }
    private var lastActivity = WeakReference<Activity>(null)

    /** Gives the silent renewal a visible Activity to attach to; without one it uses the application context, which some phones refuse. */
    fun attach(activity: Activity?) {
        lastActivity = WeakReference(activity)
    }

    private fun idOption(silent: Boolean): CredentialOption = GetGoogleIdOption.Builder()
        .setServerClientId(clientId)
        .setFilterByAuthorizedAccounts(silent)
        .setAutoSelectEnabled(silent)
        .build()

    private suspend fun token(context: Context, option: CredentialOption): String {
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val credential = manager.getCredential(context, request).credential
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            return GoogleIdTokenCredential.createFrom(credential.data).idToken
        }
        throw IllegalStateException("Unexpected credential type")
    }

    override suspend fun interactive(activity: Activity): String {
        attach(activity)
        return interactiveToken(
            chooser = { token(activity, idOption(silent = false)) },
            button = { token(activity, GetSignInWithGoogleOption.Builder(clientId).build()) },
            log = { attempt, e -> Log.w(TAG, "$attempt failed: ${e.javaClass.name}: ${e.message}") },
        )
    }

    override suspend fun silent(): String? = try {
        token(lastActivity.get()?.takeUnless { it.isFinishing || it.isDestroyed } ?: app, idOption(silent = true))
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    override suspend fun clear() {
        try {
            manager.clearCredentialState(ClearCredentialStateRequest())
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Signing out on this phone does not depend on it.
        }
    }

    private companion object {
        const val TAG = "ElectrophoneAuth"
    }
}

/**
 * The interactive sign-in: [chooser] (`GetGoogleIdOption`) first; when it finds no credential, which it also does on a
 * first sign-in on some phones, [button] (`GetSignInWithGoogleOption`, the full account chooser). Every failure goes to [log]
 * and is thrown with the attempt and the cause in its detail.
 */
internal suspend fun interactiveToken(
    chooser: suspend () -> String,
    button: suspend () -> String,
    log: (attempt: String, e: Exception) -> Unit,
): String {
    suspend fun attempt(name: String, block: suspend () -> String): String = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log(name, e)
        val detail = failureDetail(e, name)
        throw when (e) {
            is GetCredentialCancellationException -> SignInCancelled(detail)
            is NoCredentialException -> NoGoogleAccount(detail)
            else -> SignInFailed(detail)
        }
    }
    return try {
        attempt("GetGoogleIdOption", chooser)
    } catch (_: NoGoogleAccount) {
        attempt("GetSignInWithGoogleOption", button)
    }
}

/**
 * Sign-in with Google as the screens see it (AND-070 to AND-073; the iOS `AuthService`). The credential is kept in [store]
 * and restored at start, so the session survives a relaunch. A token close to its expiry is renewed silently by
 * [validToken]; when that fails and the token has expired, the session stays (with [Session.expired] true), [error] says
 * "Expired, sign in again" and [validToken] returns null. The token is never logged.
 *
 * @param source where ID tokens come from, normally [CredentialManagerGoogle]
 * @param store the encrypted store, normally [TokenStore]
 * @param scope a scope that lives as long as the app (the sign-in runs in it, so it survives the screen being recreated)
 * @param clientId the Google web client id; empty when the build has none (`android/local.properties`, AND-074)
 */
class GoogleAccount(
    private val source: GoogleTokenSource,
    private val store: CredentialStore,
    private val scope: CoroutineScope,
    private val clientId: String = BuildConfig.GOOGLE_WEB_CLIENT_ID,
    private val now: () -> Long = System::currentTimeMillis,
) : Account {
    private var credential: StoredCredential? = store.read()
    private val renewal = Mutex()
    private var lastSilentMs = Long.MIN_VALUE / 2

    private val sessionState = MutableStateFlow(credential?.let { Session(it.email, it.expiresAtMs) })
    private val busyState = MutableStateFlow(false)
    private val errorState = MutableStateFlow<String?>(null)

    override val session: StateFlow<Session?> get() = sessionState
    override val busy: StateFlow<Boolean> get() = busyState
    override val error: StateFlow<String?> get() = errorState

    override fun signInWithGoogle(activity: Activity) {
        if (clientId.isBlank()) {
            errorState.value = NOT_CONFIGURED
            return
        }
        if (busyState.value) return
        busyState.value = true
        errorState.value = null
        scope.launch {
            try {
                accept(source.interactive(activity))?.let { errorState.value = "$FAILED (token $it)" }
            } catch (e: CancellationException) {
                errorState.value = "Sign-in was interrupted ${failureDetail(e)}"
                throw e
            } catch (e: SignInCancelled) {
                errorState.value = "Sign-in was cancelled" + suffix(e.detail)
            } catch (e: NoGoogleAccount) {
                errorState.value = NO_ACCOUNT + suffix(e.detail)
            } catch (e: SignInFailed) {
                errorState.value = FAILED + suffix(e.detail)
            } catch (e: Exception) {
                errorState.value = "$FAILED ${failureDetail(e)}"
            } finally {
                busyState.value = false
            }
        }
    }

    private fun suffix(detail: String?) = if (detail != null) " $detail" else ""

    override fun signOut() {
        synchronized(this) { credential = null }
        store.clear()
        sessionState.value = null
        errorState.value = null
        scope.launch { source.clear() }
    }

    override suspend fun validToken(): String? {
        val current = synchronized(this) { credential } ?: return null
        if (current.expiresAtMs - now() > RENEW_LEAD_MS) return current.idToken
        renewal.withLock {
            val latest = synchronized(this) { credential } ?: return null
            if (latest.expiresAtMs - now() > RENEW_LEAD_MS) return latest.idToken
            val due = now() - lastSilentMs >= SILENT_RETRY_MS
            if (due) lastSilentMs = now()
            val fresh = if (clientId.isBlank() || !due) null else source.silent()
            if (fresh != null && accept(fresh) == null) return synchronized(this) { credential }?.idToken
            if (latest.expiresAtMs - now() > EXPIRY_MARGIN_MS) return latest.idToken
            if (synchronized(this) { credential } != null) errorState.value = EXPIRED
            return null
        }
    }

    /** Stores a token that parses and is not expired and returns null; otherwise says why it was rejected. */
    private fun accept(token: String): String? {
        val claims = Jwt.claims(token) ?: return "unparseable"
        if (claims.expiresAtMs <= now()) return "expired"
        val fresh = StoredCredential(token, claims.expiresAtMs, claims.email ?: synchronized(this) { credential }?.email)
        synchronized(this) { credential = fresh }
        store.write(fresh)
        sessionState.value = Session(fresh.email, fresh.expiresAtMs)
        errorState.value = null
        return null
    }

    companion object {
        const val NOT_CONFIGURED = "Google sign-in is not configured in this build."
        private const val FAILED = "Google sign-in failed. Try again."
        private const val NO_ACCOUNT = "No Google account on this phone. Add one in the phone's settings and try again."

        /** The IOS-013 wording. */
        const val EXPIRED = "Expired, sign in again"

        /** A token with less than this left is renewed before it is used. */
        const val RENEW_LEAD_MS = 5 * 60_000L
        private const val EXPIRY_MARGIN_MS = 10_000L

        /** A silent renewal that did not help is not asked again sooner than this, so a failing one cannot loop. */
        const val SILENT_RETRY_MS = 60_000L
    }
}
