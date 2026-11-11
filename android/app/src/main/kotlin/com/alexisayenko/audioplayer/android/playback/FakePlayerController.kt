package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlin.random.Random
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A [PlayerController] that lives in memory, for Compose previews and UI tests: no Android class, no service, no sound.
 * It runs the real queue rules ([PlaybackEngine], so Next, Previous, shuffle, repeat and the queue edits behave as in the
 * app) over a pretend output in which every song has a file. Time stands still until [advanceBy] moves it.
 */
class FakePlayerController(
    songs: List<Song> = emptyList(),
    startIndex: Int = 0,
    playing: Boolean = false,
    random: Random = Random.Default,
) : PlayerController {
    private val _state = MutableStateFlow(PlayerState())
    private val output = Output()
    private val engine = PlaybackEngine(output, fileFor = { File(it) }, random = random, onState = { _state.value = it })

    override val state: StateFlow<PlayerState> = _state.asStateFlow()

    init {
        if (songs.isNotEmpty()) {
            engine.play(songs, startIndex)
            if (!playing) engine.pause()
        }
    }

    /** Lets [ms] of playing time pass; at the end of a song the queue advances as it would in the app. Paused, nothing moves. */
    fun advanceBy(ms: Long) {
        if (!output.isPlaying) return
        val length = output.durationMs
        output.positionMs += ms
        if (length > 0 && output.positionMs >= length) {
            output.positionMs = length
            output.ended = true
            engine.onEnded()
        }
        engine.onOutputReady()
    }

    override fun play(songs: List<Song>, startIndex: Int) = engine.play(songs, startIndex)

    override fun playAll(songs: List<Song>) = engine.playAll(songs)

    override fun playNow(song: Song) = engine.playNow(song)

    override fun playNext(song: Song) = engine.playNext(song)

    override fun enqueue(songs: List<Song>): Int = engine.enqueue(songs)

    override fun toggle() = engine.toggle()

    override fun pause() = engine.pause()

    override fun resume() = engine.resume()

    override fun next() = engine.next()

    override fun previous() = engine.previous()

    override fun seekTo(positionMs: Long) = engine.seekTo(positionMs)

    override fun skipBy(deltaMs: Long) = engine.skipBy(deltaMs)

    override fun jumpTo(index: Int) = engine.jumpTo(index)

    override fun removeFromQueue(index: Int) = engine.removeFromQueue(index)

    override fun moveQueueItem(from: Int, to: Int) = engine.moveQueueItem(from, to)

    override fun clearQueue() = engine.clearQueue()

    override fun setShuffle(on: Boolean) = engine.setShuffle(on)

    override fun setRepeat(mode: RepeatMode) = engine.setRepeat(mode)

    private class Output : AudioOutput {
        override var positionMs = 0L
        override var durationMs = 0L
        var wantsPlay = false
        var ended = false
        override val isPlaying: Boolean get() = wantsPlay && !ended

        override fun load(song: Song, file: File, positionMs: Long, play: Boolean) {
            this.positionMs = positionMs
            durationMs = ((song.duration ?: 0.0) * 1000).toLong()
            wantsPlay = play
            ended = false
        }

        override fun play() {
            if (ended) positionMs = 0
            ended = false
            wantsPlay = true
        }

        override fun pause() {
            wantsPlay = false
        }

        override fun seekTo(positionMs: Long) {
            this.positionMs = positionMs
            ended = false
        }

        override fun clear() {
            positionMs = 0
            durationMs = 0
            wantsPlay = false
            ended = false
        }
    }
}
