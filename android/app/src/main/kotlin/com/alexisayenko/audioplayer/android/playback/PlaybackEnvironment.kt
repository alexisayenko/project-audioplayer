package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import java.io.File

/**
 * Everything the playback service needs from the rest of the app. `App` builds one and sets it as
 * [PlaybackService.environment] in `onCreate`, before any screen or the service can run. All functions are called on the
 * main thread and must answer from memory or the local disk; none may touch the network (AND-001, AND-066).
 */
interface PlaybackEnvironment {
    /** The audio file of the song on this phone, or null when it is not downloaded. The service checks that it exists. */
    fun fileFor(songId: String): File?

    /** A cover image of the song on local disk (the cached cover of AND-022), or null. Shown in the notification and on the lock screen. */
    fun coverFor(song: Song): File?

    /**
     * Listen plus skip counts of the last 30 days per song id (the iOS `ListeningStore.recentCounts`), or null when they are
     * not known; then the shuffle is uniform (IOS-105).
     */
    fun listenCounts(): Map<String, Int>?

    /** The song with this id from the library or the phone index, or null when it is gone. */
    fun song(id: String): Song?

    /**
     * Returns once the songs on this phone are known (the phone index is read), so [song] and [fileFor] can answer.
     * The saved queue is restored only after it returns (AND-064).
     */
    suspend fun awaitLibrary()

    /** Where finished plays are posted (`POST /plays`); see [PlaySink]. */
    val playSink: PlaySink
}

/** Something the playback service reports to the screens, beyond the state. */
sealed interface PlaybackEvent {
    /** Songs that were skipped because their file is not on the phone (AND-066): the screens show one toast for them. */
    data class SkippedMissing(val songs: List<Song>) : PlaybackEvent

    /** The file of this song is on the phone but could not be played. */
    data class Failed(val song: Song) : PlaybackEvent
}
