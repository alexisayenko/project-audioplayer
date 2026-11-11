package com.alexisayenko.audioplayer.android.data

import kotlinx.coroutines.flow.StateFlow

/** The switches in Settings (the iOS `Settings`); kept in Preferences DataStore (AND-023). */
interface AppSettings {
    val serverUrl: String

    /** Off: file downloads wait for an unmetered network (IOS-017). */
    val useMobileData: StateFlow<Boolean>

    /** On: a song that reaches the server is downloaded to the phone without asking (IOS-022). */
    val downloadNewAutomatically: StateFlow<Boolean>

    fun setUseMobileData(on: Boolean)
    fun setDownloadNewAutomatically(on: Boolean)
}
