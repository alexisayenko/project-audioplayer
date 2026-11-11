package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlinx.serialization.Serializable

/**
 * What survives a relaunch: the queue, the current song and where it stood (IOS-104, AND-064; the Swift `SavedPlayback`).
 * [position] is in seconds; an older file without it still reads.
 */
@Serializable
data class SavedPlayback(
    val ids: List<String>,
    val index: Int,
    val tags: List<String> = emptyList(),
    val position: Double? = null,
)

/** Shuffle and repeat as they are kept between runs (AND-063); [repeat] is `off`, `all` or `one`. */
@Serializable
data class SavedModes(val shuffle: Boolean = false, val repeat: String = "off")

/** The resume rule (the Swift `ResumePosition`). Seconds. */
object ResumePosition {
    /** A saved position at or below this starts from 0. */
    const val MIN_START = 3.0

    /** A saved position closer than this to the end starts from 0. */
    const val END_GUARD = 5.0

    /** The position to seek to after a relaunch: the saved one when it is above 3 s and at least 5 s before the end, else 0. */
    fun start(saved: Double?, duration: Double?): Double {
        if (saved == null || !saved.isFinite() || saved <= MIN_START) return 0.0
        if (duration != null && duration.isFinite() && duration > 0 && saved > duration - END_GUARD) return 0.0
        return saved
    }
}

/**
 * Decides when a playing position is written (the Swift `ResumeCheckpoint`): at most every 5 s while playing, at once when
 * not playing (pause, seek). Times are epoch milliseconds.
 */
class ResumeCheckpoint {
    private var lastWrite: Long? = null

    /** Whether a write is due at [nowMs]; a true answer counts as the write. */
    fun due(nowMs: Long, playing: Boolean): Boolean {
        val last = lastWrite
        if (playing && last != null && nowMs - last < INTERVAL_MS) return false
        lastWrite = nowMs
        return true
    }

    companion object {
        const val INTERVAL_MS = 5_000L
    }
}

/** A saved queue matched against the songs that can play now: what the player restores, paused. */
data class RestoredPlayback(val songs: List<Song>, val index: Int, val tags: List<String>, val position: Double)

/**
 * Keeps the queue and the playback position between runs: the Kotlin port of `PlaybackPersistence.swift` (IOS-104, AND-064).
 * iOS keeps them in `UserDefaults`; here they are two small JSON files under [directory] (`playback.json` with the iOS shape
 * `{ids, index, tags, position}` and `modes.json` for shuffle and repeat), written atomically and at once, so a pause is on
 * disk before the process can be killed. Nothing is written until [begin] is called, so a start cannot overwrite the saved
 * queue before it was read.
 */
class PlaybackPersistence(private val directory: File, private val now: () -> Long = System::currentTimeMillis) {
    private var began = false
    private val checkpoint = ResumeCheckpoint()
    private var savedID: String? = null
    private var lastPosition: Double? = null

    /** The saved queue, or null when there is none or the file is broken. */
    fun saved(): SavedPlayback? = PlayStore.read(SavedPlayback.serializer(), QUEUE_FILE, directory)

    /** The saved shuffle and repeat; the defaults when nothing was saved. */
    fun savedModes(): SavedModes = PlayStore.read(SavedModes.serializer(), MODES_FILE, directory) ?: SavedModes()

    /** Writes shuffle and repeat. */
    fun saveModes(shuffle: Boolean, repeat: RepeatMode) =
        PlayStore.write(SavedModes.serializer(), SavedModes(shuffle, repeat.rawValue), MODES_FILE, directory)

    /** Starts saving, after the restore was tried. [current] is what the player holds now. */
    fun begin(current: SavedPlayback?) {
        began = true
        savedID = current?.let { it.ids.getOrNull(it.index) }
        if (savedID != null && current != null) store(current)
    }

    /** The queue, the current song or the tags changed: written at once. A new current song starts at position 0. */
    fun queueChanged(state: SavedPlayback) {
        if (!began) return
        val id = state.ids.getOrNull(state.index)
        val sameSong = id != null && id == savedID
        savedID = id
        store(state.copy(position = if (sameSong) state.position else 0.0))
    }

    /** A position tick: written at most every 5 s while [playing], at once otherwise. */
    fun positionChanged(state: SavedPlayback, playing: Boolean) {
        if (!began || state.position == lastPosition) return
        if (!checkpoint.due(now(), playing)) return
        store(state)
    }

    /** A pause, a seek, the app going to the background or the player going away: written at once. */
    fun saveNow(state: SavedPlayback) {
        if (!began) return
        store(state)
    }

    private fun store(state: SavedPlayback) {
        lastPosition = state.position
        PlayStore.write(SavedPlayback.serializer(), state, QUEUE_FILE, directory)
    }

    companion object {
        private const val QUEUE_FILE = "playback.json"
        private const val MODES_FILE = "modes.json"

        /**
         * Matches a saved queue against the library: songs that are gone or cannot play now (their file is not on the phone)
         * are dropped; the saved song stays current when it survived, at the position the resume rule allows; otherwise the
         * first song at 0. Null when nothing is left.
         */
        fun resolve(saved: SavedPlayback, song: (String) -> Song?, isPlayable: (Song) -> Boolean): RestoredPlayback? {
            val seen = mutableSetOf<String>()
            val songs = saved.ids.filter { seen.add(it) }.mapNotNull(song).filter(isPlayable)
            if (songs.isEmpty()) return null
            val wanted = saved.ids.getOrNull(saved.index)
            val found = songs.indexOfFirst { it.id == wanted }
            val position = if (found >= 0) ResumePosition.start(saved.position, songs[found].duration) else 0.0
            return RestoredPlayback(songs, maxOf(found, 0), saved.tags, position)
        }
    }
}
