package com.alexisayenko.audioplayer.android.auth

import android.app.Activity
import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.alexisayenko.audioplayer.android.BuildConfig
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.lang.ref.WeakReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The person closed the account chooser: not an error to show. */
class SignInCancelled : Exception("Sign-in cancelled")

/** The phone has no Google account that can sign in. */
class NoGoogleAccount : Exception("No Google account")

/** Asks Google for an ID token. The real one is [CredentialManagerGoogle]; tests use a fake. */
interface GoogleTokenSource {
    /** Shows the account chooser on [activity] and returns the ID token. Throws [SignInCancelled] or [NoGoogleAccount]. */
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

    private fun request(silent: Boolean): GetCredentialRequest {
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(clientId)
            .setFilterByAuthorizedAccounts(silent)
            .setAutoSelectEnabled(silent)
            .build()
        return GetCredentialRequest.Builder().addCredentialOption(option).build()
    }

    private suspend fun token(context: Context, silent: Boolean): String {
        val credential = manager.getCredential(context, request(silent)).credential
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            return GoogleIdTokenCredential.createFrom(credential.data).idToken
        }
        throw IllegalStateException("Unexpected credential type")
    }

    override suspend fun interactive(activity: Activity): String {
        attach(activity)
        return try {
            token(activity, silent = false)
        } catch (e: GetCredentialCancellationException) {
            throw SignInCancelled()
        } catch (e: NoCredentialException) {
            throw NoGoogleAccount()
        }
    }

    override suspend fun silent(): String? = try {
        token(lastActivity.get()?.takeUnless { it.isFinishing || it.isDestroyed } ?: app, silent = true)
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
}

/**
 * Sign-in with Google as the screens see it (AND-070 to AND-073; the iOS `AuthService`). The credential is kept in [store]
 * and restored at start, so the session survives a relaunch. A token close to its expiry is renewed silently by
 * [validToken]; when that fails and the token has expired, the session stays (with [Session.expired] true), [error] says
 * "Expired, sign in again" and [validToken] returns null. The token is never logged.
 *
 * @param source where ID tokens come from, normally [CredentialManagerGoogle]
 * @param store the encrypted store, normally [TokenStore]
 * @param scope a scope that lives as long as the app (used for sign-out housekeeping)
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

    override suspend fun signInWithGoogle(activity: Activity) {
        if (clientId.isBlank()) {
            errorState.value = NOT_CONFIGURED
            return
        }
        if (busyState.value) return
        busyState.value = true
        errorState.value = null
        try {
            if (!accept(source.interactive(activity))) errorState.value = "Google sign-in failed. Try again."
        } catch (e: CancellationException) {
            throw e
        } catch (_: SignInCancelled) {
            // The person closed the sheet.
        } catch (_: NoGoogleAccount) {
            errorState.value = "No Google account on this phone. Add one in the phone's settings and try again."
        } catch (_: Exception) {
            errorState.value = "Google sign-in failed. Try again."
        } finally {
            busyState.value = false
        }
    }

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
            if (fresh != null && accept(fresh)) return synchronized(this) { credential }?.idToken
            if (latest.expiresAtMs - now() > EXPIRY_MARGIN_MS) return latest.idToken
            if (synchronized(this) { credential } != null) errorState.value = EXPIRED
            return null
        }
    }

    /** Stores a token that parses and is not expired; false otherwise. */
    private fun accept(token: String): Boolean {
        val claims = Jwt.claims(token) ?: return false
        if (claims.expiresAtMs <= now()) return false
        val fresh = StoredCredential(token, claims.expiresAtMs, claims.email ?: synchronized(this) { credential }?.email)
        synchronized(this) { credential = fresh }
        store.write(fresh)
        sessionState.value = Session(fresh.email, fresh.expiresAtMs)
        errorState.value = null
        return true
    }

    companion object {
        const val NOT_CONFIGURED = "Google sign-in is not configured in this build."

        /** The IOS-013 wording. */
        const val EXPIRED = "Expired, sign in again"

        /** A token with less than this left is renewed before it is used. */
        const val RENEW_LEAD_MS = 5 * 60_000L
        private const val EXPIRY_MARGIN_MS = 10_000L

        /** A silent renewal that did not help is not asked again sooner than this, so a failing one cannot loop. */
        const val SILENT_RETRY_MS = 60_000L
    }
}
