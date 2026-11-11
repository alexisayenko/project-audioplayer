package com.alexisayenko.audioplayer.android

import androidx.compose.runtime.staticCompositionLocalOf
import com.alexisayenko.audioplayer.android.auth.Account
import com.alexisayenko.audioplayer.android.data.AppSettings
import com.alexisayenko.audioplayer.android.data.Library
import com.alexisayenko.audioplayer.android.playback.PlayerController

/** The app's services, wired by hand in [App] (no DI framework in v1, AND-092). Screens read it through [LocalAppGraph]. */
interface AppGraph {
    val library: Library
    val player: PlayerController
    val account: Account
    val settings: AppSettings
}

val LocalAppGraph = staticCompositionLocalOf<AppGraph> { error("No AppGraph provided") }
