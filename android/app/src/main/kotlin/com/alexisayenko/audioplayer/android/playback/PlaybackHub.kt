package com.alexisayenko.audioplayer.android.playback

import android.content.Context
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The in-process link between the playback service and the screens. The service and the UI run in one process, so the
 * things a Media3 `Player` cannot carry (the [com.alexisayenko.audioplayer.android.model.Song] objects of the queue, the
 * queue edits, skipped-song reports) do not go through session commands and Bundles: the service publishes its
 * [PlayerState] here and [MediaPlayerController] hands it commands here, in call order, on the main thread.
 *
 * Commands given while the service is not running are kept (the newest [MAX_PENDING]) and run as soon as it has started
 * and restored the saved queue. Main thread only.
 */
object PlaybackHub {
    private const val MAX_PENDING = 32

    private val _state = MutableStateFlow(PlayerState())

    /** What the service last published; it stays after the service stopped, paused. */
    val state: StateFlow<PlayerState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<PlaybackEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** Skipped and failed songs, for a toast (AND-066). */
    val events: SharedFlow<PlaybackEvent> = _events.asSharedFlow()

    /** Whether a screen of the app is visible; [MediaPlayerController] keeps it. The service stops itself only in the background (AND-067). */
    internal val appInForeground = MutableStateFlow(false)

    /** Sends outlive the service: a batch in flight is not cut off when the service stops. */
    private val logScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    internal var engine: PlaybackEngine? = null
        private set
    private var playLog: PlayLog? = null
    private val pending = ArrayDeque<(PlaybackEngine) -> Unit>()

    /**
     * Called on the main thread each time the server accepted a batch of plays (the iOS `playsUploaded` notice). The app
     * may set it to refresh the listen counts the shuffle uses.
     */
    @Volatile
    var onPlaysUploaded: (() -> Unit)? = null

    /** Set by [MediaPlayerController]: connects it, which starts the service. */
    internal var wake: (() -> Unit)? = null

    /** Set by [MediaPlayerController]: lets go of the service so it can stop. */
    internal var release: (() -> Unit)? = null

    /** Runs [command] on the engine now, or when the service has started. */
    internal fun submit(command: (PlaybackEngine) -> Unit) {
        val running = engine
        if (running != null) return command(running)
        if (pending.size >= MAX_PENDING) pending.removeFirst()
        pending.addLast(command)
        wake?.invoke()
    }

    internal fun attach(engine: PlaybackEngine) {
        this.engine = engine
        while (pending.isNotEmpty()) pending.removeFirst()(engine)
    }

    internal fun detach(engine: PlaybackEngine) {
        if (this.engine !== engine) return
        this.engine = null
        _state.value = _state.value.copy(isPlaying = false)
    }

    internal fun publish(state: PlayerState) {
        _state.value = state
    }

    internal fun emit(event: PlaybackEvent) {
        _events.tryEmit(event)
    }

    /** The process-wide play log (`filesDir/plays`). It posts through [PlaybackService.environment]; without one nothing is sent. */
    internal fun playLog(context: Context): PlayLog {
        playLog?.let { return it }
        val sink = PlaySink { key, plays -> PlaybackService.environment?.playSink?.post(key, plays) }
        return PlayLog(playsDirectory(context), sink, logScope).also {
            it.onUploaded = { onPlaysUploaded?.invoke() }
            playLog = it
        }
    }

    internal fun playsDirectory(context: Context) = File(context.applicationContext.filesDir, "plays")

    /**
     * Sends the plays that are waiting (AND-065). The app calls it when the person signs in and when the network comes back;
     * [force] forgets a pending retry wait. Safe to call at any time on the main thread.
     */
    fun flushPlays(context: Context, force: Boolean = true) {
        playLog(context).flush(force)
    }
}
