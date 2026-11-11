package com.alexisayenko.audioplayer.android.playback

import android.content.ComponentName
import android.content.Context
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.alexisayenko.audioplayer.android.model.Song
import com.google.common.util.concurrent.ListenableFuture
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch

/**
 * The player as the screens use it (AND-036, AND-060): the real [PlayerController]. `App` creates one, on the main thread,
 * and keeps it for the life of the process.
 *
 * It connects a Media3 `MediaController` to [PlaybackService] through the service's session token; the connection is made
 * when the app comes to the foreground or a command needs the service, it is what starts the service, and it supplies the
 * running position. The state itself and every command go through the in-process [PlaybackHub], not through session
 * commands: the queue is made of `Song` objects that a Media3 `Player` cannot carry, and one ordered path on the main
 * thread means a pause can never overtake the play before it. The lock screen, the notification and headsets use the
 * session; both paths end in the same engine inside the service.
 *
 * [state] is one flow for everything; while a song plays its position is refreshed about four times a second, and not at
 * all while paused. All functions must be called on the main thread.
 */
class MediaPlayerController(context: Context) : PlayerController {
    private val appContext = context.applicationContext
    private val scope = MainScope()
    private val _state = MutableStateFlow(PlaybackHub.state.value)
    private var controller: MediaController? = null
    private var connecting: ListenableFuture<MediaController>? = null

    override val state: StateFlow<PlayerState> = _state.asStateFlow()

    /** Skipped songs (file not on the phone, AND-066) and songs that failed to play: the screens show a toast for each. */
    val events: SharedFlow<PlaybackEvent> get() = PlaybackHub.events

    init {
        PlaybackHub.wake = ::connect
        PlaybackHub.release = ::disconnect
        scope.launch {
            PlaybackHub.state.collectLatest { published ->
                _state.value = published
                while (published.isPlaying) {
                    delay(TICK_MS)
                    _state.value = published.copy(positionMs = livePosition() ?: published.positionMs)
                }
            }
        }
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    PlaybackHub.appInForeground.value = true
                    connect()
                    PlaybackHub.flushPlays(appContext, force = false)
                }

                override fun onStop(owner: LifecycleOwner) {
                    PlaybackHub.appInForeground.value = false
                    PlaybackHub.engine?.backgrounded()
                }
            },
        )
    }

    override fun play(songs: List<Song>, startIndex: Int) = send { it.play(songs, startIndex) }

    override fun playAll(songs: List<Song>) = send { it.playAll(songs) }

    override fun playNow(song: Song) = send { it.playNow(song) }

    override fun playNext(song: Song) = send { it.playNext(song) }

    override fun enqueue(songs: List<Song>): Int {
        val added = PlaybackEngine.fresh(PlaybackHub.state.value.queue, songs).size
        send { it.enqueue(songs) }
        return added
    }

    override fun toggle() = send { it.toggle() }

    override fun pause() = send { it.pause() }

    override fun resume() = send { it.resume() }

    override fun next() = send { it.next() }

    override fun previous() = send { it.previous() }

    override fun seekTo(positionMs: Long) = send { it.seekTo(positionMs) }

    override fun skipBy(deltaMs: Long) = send { it.skipBy(deltaMs) }

    override fun jumpTo(index: Int) = send { it.jumpTo(index) }

    override fun removeFromQueue(index: Int) = send { it.removeFromQueue(index) }

    override fun moveQueueItem(from: Int, to: Int) = send { it.moveQueueItem(from, to) }

    override fun clearQueue() = send { it.clearQueue() }

    override fun setShuffle(on: Boolean) = send { it.setShuffle(on) }

    override fun setRepeat(mode: RepeatMode) = send { it.setRepeat(mode) }

    private fun send(command: (PlaybackEngine) -> Unit) = PlaybackHub.submit(command)

    /** The position right now: from the media controller while it is connected, else from the engine. */
    private fun livePosition(): Long? =
        controller?.takeIf { it.isConnected && it.currentMediaItem != null }?.currentPosition?.coerceAtLeast(0)
            ?: PlaybackHub.engine?.positionMs

    /** Connects to the service, starting it when it is not running. Safe to call again. */
    private fun connect() {
        if (controller != null || connecting != null) return
        val token = SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java))
        val listener = object : MediaController.Listener {
            override fun onDisconnected(controller: MediaController) {
                if (this@MediaPlayerController.controller === controller) this@MediaPlayerController.controller = null
            }
        }
        val future = MediaController.Builder(appContext, token).setListener(listener).buildAsync()
        connecting = future
        scope.launch {
            try {
                val connected = future.await()
                if (connecting === future) controller = connected else connected.release()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "could not connect to the playback service: ${e.message}")
            } finally {
                if (connecting === future) connecting = null
            }
        }
    }

    /** Lets go of the service so it can stop (AND-067); the next foreground or command connects again. */
    private fun disconnect() {
        connecting?.let { MediaController.releaseFuture(it) }
        connecting = null
        controller?.release()
        controller = null
    }

    private companion object {
        const val TAG = "MediaPlayerController"
        const val TICK_MS = 250L
    }
}
