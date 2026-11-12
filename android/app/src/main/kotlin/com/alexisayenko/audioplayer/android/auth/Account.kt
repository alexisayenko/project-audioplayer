package com.alexisayenko.audioplayer.android.auth

import android.app.Activity
import kotlinx.coroutines.flow.StateFlow

/** The signed-in account. The ID token itself never leaves the auth package and the API client. */
data class Session(val email: String?, val expiresAtMs: Long) {
    fun expired(nowMs: Long = System.currentTimeMillis()): Boolean = expiresAtMs <= nowMs
}

/** Sign-in as the screens see it (the iOS `AuthService`). v1 is Google only (AND-070). */
interface Account {
    /** Null when signed out. */
    val session: StateFlow<Session?>
    val busy: StateFlow<Boolean>

    /** The last sign-in failure in words for the person, or null. */
    val error: StateFlow<String?>

    /** Shows the Google account chooser; needs an Activity for the Credential Manager sheet. Returns at once; the outcome arrives in [session] or [error]. */
    fun signInWithGoogle(activity: Activity)
    fun signOut()

    /** A token that is not expired, renewed silently when needed; null when signed out or renewal needs the person (AND-072). */
    suspend fun validToken(): String?
}
