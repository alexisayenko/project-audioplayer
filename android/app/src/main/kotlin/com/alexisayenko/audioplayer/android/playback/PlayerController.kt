package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import kotlinx.coroutines.flow.StateFlow

enum class RepeatMode { Off, All, One }

/** Everything the playback UI shows. The service owns it; composables only read it (AND-036, AND-060). */
data class PlayerState(
    val queue: List<Song> = emptyList(),
    val index: Int = -1,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.Off,
    /** The song whose file could not be played (missing or broken), if the last attempt failed. */
    val failedSongId: String? = null,
) {
    val current: Song? get() = queue.getOrNull(index)
    val hasNext: Boolean get() = queue.isNotEmpty() && (repeat != RepeatMode.Off || shuffle || index < queue.lastIndex)
}

/**
 * The player as the UI sees it: the Android counterpart of the iOS `PlayerService` API. The real implementation talks to the
 * Media3 session service through a `MediaController`; previews and tests use `FakePlayerController`.
 * Only songs whose audio is on the phone are ever played (AND-001, AND-066).
 */
interface PlayerController {
    val state: StateFlow<PlayerState>

    /** Replaces the queue with [songs] and starts at [startIndex]. */
    fun play(songs: List<Song>, startIndex: Int)

    /** Replaces the queue with [songs]; starts at the first song, or at a weighted random one when shuffle is on. */
    fun playAll(songs: List<Song>)

    /** Plays [song] now, keeping the rest of the queue. */
    fun playNow(song: Song)

    /** Inserts [song] right after the current one. */
    fun playNext(song: Song)

    /** Appends the songs not yet in the queue; returns how many were added. */
    fun enqueue(songs: List<Song>): Int

    fun toggle()
    fun pause()
    fun resume()
    fun next()
    fun previous()
    fun seekTo(positionMs: Long)
    fun skipBy(deltaMs: Long)
    fun jumpTo(index: Int)
    fun removeFromQueue(index: Int)
    fun moveQueueItem(from: Int, to: Int)

    /** Empties the queue except the current song. */
    fun clearQueue()
    fun setShuffle(on: Boolean)
    fun setRepeat(mode: RepeatMode)
}
