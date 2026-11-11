package com.alexisayenko.audioplayer.android.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.FileDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.alexisayenko.audioplayer.android.R
import com.alexisayenko.audioplayer.android.model.Song
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.File
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * Plays the songs on this phone with the screen locked: a Media3 session service with ExoPlayer (AND-060 to AND-067), the
 * Android counterpart of the audio half of the iOS `PlayerService`.
 *
 * How the queue and shuffle are done. The queue is owned by [PlaybackEngine] (the port of the iOS rules), not by ExoPlayer's
 * playlist: ExoPlayer holds one song at a time, as `AVPlayer` does on iOS, and every Next, Previous and end-of-song is
 * decided by [QueueAdvance] with [ShufflePick]. The spec (AND-063) sketched the whole queue as ExoPlayer items with a custom
 * `ShuffleOrder`; that was not done because a `ShuffleOrder` is one fixed permutation, while the iOS shuffle is a round that
 * is re-ranked when listen counts arrive, restarts fresh under repeat-all, steps back through the history of what was
 * really played, and must skip songs whose file is missing (AND-066). Driving it here keeps one set of rules, tested on the
 * JVM, for both phones. The lock screen, the notification, headsets, Bluetooth and Android Auto still get correct Next and
 * Previous: the session's player is a [ForwardingSimpleBasePlayer] that always offers the next and previous commands and
 * routes them, with play, pause, seek, shuffle mode and repeat mode, to the engine. The cost is no gapless transition.
 *
 * Only `file://` URIs of the app's own audio files are ever loaded, through a file-only data source, so nothing can play
 * from the network (AND-001, AND-066).
 *
 * The rest of the app reaches the service through [PlaybackHub] and [MediaPlayerController]; what the service needs from
 * the app comes through [environment].
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private val handler = Handler(Looper.getMainLooper())
    private val scope = MainScope()
    private lateinit var exo: ExoPlayer
    private lateinit var engine: PlaybackEngine
    private lateinit var sessionPlayer: SessionPlayer
    internal lateinit var session: MediaSession
        private set
    private var shownModes: Pair<Boolean, RepeatMode>? = null
    private var ticking = false
    private var idleArmed = false

    private val ticker = object : Runnable {
        override fun run() {
            engine.tick()
            if (engine.isPlaying) handler.postDelayed(this, TICK_MS) else ticking = false
        }
    }

    private val idleStop = Runnable { stopWhenIdle() }

    override fun onCreate() {
        super.onCreate()
        val environment: PlaybackEnvironment? = Companion.environment
        if (environment == null) Log.w(TAG, "PlaybackService.environment is not set; nothing can be played")
        exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(FileDataSource.Factory()))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .setSeekBackIncrementMs(SKIP_MS)
            .setSeekForwardIncrementMs(SKIP_MS)
            .build()
        val log = PlaybackHub.playLog(this)
        val persistence = PlaybackPersistence(File(filesDir, "playback"))
        engine = PlaybackEngine(
            output = ExoOutput(),
            fileFor = { id -> environment?.fileFor(id)?.takeIf { it.isFile } },
            listenCounts = { environment?.listenCounts() },
            recorder = PlayRecorder(log, PlaybackHub.playsDirectory(this)),
            playLog = log,
            persistence = persistence,
            onEvent = PlaybackHub::emit,
            onState = ::onEngineState,
        )
        exo.addListener(PlayerEvents())
        sessionPlayer = SessionPlayer(exo, engine)
        val builder = MediaSession.Builder(this, sessionPlayer)
            .setCallback(SessionCallback())
            .setMediaButtonPreferences(buttons())
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            builder.setSessionActivity(PendingIntent.getActivity(this, 0, launch, flags))
        }
        session = builder.build()
        shownModes = engine.shuffle to engine.repeat
        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setChannelName(R.string.playback_channel_name)
                .build()
                .apply { setSmallIcon(R.drawable.ic_stat_playback) },
        )
        scope.launch {
            // The saved queue needs the library to turn ids into songs; commands from the screens wait until it is back.
            try {
                environment?.awaitLibrary()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "the library did not load; starting with what is known: ${e.message}")
            }
            engine.restore(persistence.saved()) { id -> environment?.song(id) }
            PlaybackHub.attach(engine)
            log.flush()
        }
        scope.launch { PlaybackHub.appInForeground.onEach { updateIdleTimer() }.collect() }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession = session

    /** The app was swiped away: playing goes on; paused, the service leaves with the notification. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (engine.isPlaying) super.onTaskRemoved(rootIntent) else stopWhenIdle()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
        engine.shutdown()
        PlaybackHub.detach(engine)
        session.release()
        exo.release()
        super.onDestroy()
    }

    private fun onEngineState(state: PlayerState) {
        PlaybackHub.publish(state)
        sessionPlayer.refresh()
        val modes = state.shuffle to state.repeat
        if (modes != shownModes) {
            shownModes = modes
            session.setMediaButtonPreferences(buttons())
        }
        if (engine.isPlaying && !ticking) {
            ticking = true
            handler.postDelayed(ticker, TICK_MS)
        }
        updateIdleTimer()
    }

    /** AND-067: after 10 minutes paused with the app in the background the service stops, so the notification does not linger. */
    private fun updateIdleTimer() {
        val idle = !engine.isPlaying && !PlaybackHub.appInForeground.value
        if (idle == idleArmed) return
        idleArmed = idle
        handler.removeCallbacks(idleStop)
        if (idle) handler.postDelayed(idleStop, IDLE_STOP_MS)
    }

    private fun stopWhenIdle() {
        engine.backgrounded()
        PlaybackHub.release?.invoke() // the screens let go of their controller, or the bound service could not stop
        pauseAllPlayersAndStopSelf()
    }

    /** The custom keys of the notification (AND-061); the icons of shuffle and repeat follow the current modes. */
    private fun buttons(): List<CommandButton> {
        val shuffleIcon = if (engine.shuffle) CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF
        val repeatIcon = when (engine.repeat) {
            RepeatMode.Off -> CommandButton.ICON_REPEAT_OFF
            RepeatMode.All -> CommandButton.ICON_REPEAT_ALL
            RepeatMode.One -> CommandButton.ICON_REPEAT_ONE
        }
        return listOf(
            CommandButton.Builder(CommandButton.ICON_SKIP_BACK_10)
                .setSessionCommand(SessionCommand(COMMAND_SKIP_BACK, Bundle.EMPTY))
                .setDisplayName(getString(R.string.playback_skip_back))
                .setSlots(CommandButton.SLOT_BACK_SECONDARY, CommandButton.SLOT_OVERFLOW)
                .build(),
            CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_10)
                .setSessionCommand(SessionCommand(COMMAND_SKIP_FORWARD, Bundle.EMPTY))
                .setDisplayName(getString(R.string.playback_skip_forward))
                .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
                .build(),
            CommandButton.Builder(shuffleIcon)
                .setSessionCommand(SessionCommand(COMMAND_SHUFFLE, Bundle.EMPTY))
                .setDisplayName(getString(if (engine.shuffle) R.string.playback_shuffle_on else R.string.playback_shuffle_off))
                .setSlots(CommandButton.SLOT_OVERFLOW)
                .build(),
            CommandButton.Builder(repeatIcon)
                .setSessionCommand(SessionCommand(COMMAND_REPEAT, Bundle.EMPTY))
                .setDisplayName(
                    getString(
                        when (engine.repeat) {
                            RepeatMode.Off -> R.string.playback_repeat_off
                            RepeatMode.All -> R.string.playback_repeat_all
                            RepeatMode.One -> R.string.playback_repeat_one
                        },
                    ),
                )
                .setSlots(CommandButton.SLOT_OVERFLOW)
                .build(),
        )
    }

    /** ExoPlayer as the engine's one-song output. */
    private inner class ExoOutput : AudioOutput {
        override val positionMs: Long get() = exo.currentPosition.coerceAtLeast(0)
        override val durationMs: Long get() = exo.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
        override val isPlaying: Boolean get() = exo.isPlaying

        override fun load(song: Song, file: File, positionMs: Long, play: Boolean) {
            exo.setMediaItem(NowPlaying.mediaItem(song, file, environment?.coverFor(song)?.takeIf { it.isFile }), positionMs)
            exo.playWhenReady = play
            // A song that is only cued (restored after a relaunch) is not prepared: no notification until Play is pressed.
            if (play) exo.prepare() else if (exo.playbackState != Player.STATE_IDLE) exo.stop()
        }

        override fun play() {
            if (exo.playbackState == Player.STATE_IDLE) exo.prepare()
            if (exo.playbackState == Player.STATE_ENDED) exo.seekTo(0)
            exo.play()
        }

        override fun pause() = exo.pause()

        override fun seekTo(positionMs: Long) = exo.seekTo(positionMs)

        override fun clear() {
            exo.playWhenReady = false
            exo.stop()
            exo.clearMediaItems()
        }
    }

    private inner class PlayerEvents : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_ENDED -> engine.onEnded()
                Player.STATE_READY -> engine.onOutputReady()
                else -> Unit
            }
        }

        /** Sound starts: the play recorder gets its first position at once, not half a second late. */
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) engine.tick()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = outputChanged()

        override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) = outputChanged()

        override fun onPlayerError(error: PlaybackException) {
            Log.w(TAG, "playback failed: ${error.errorCodeName}")
            engine.onOutputFailed()
        }

        private fun outputChanged() =
            engine.onOutputChanged(exo.playWhenReady, exo.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE)
    }

    private inner class SessionCallback : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
            CUSTOM_COMMANDS.forEach { commands.add(SessionCommand(it, Bundle.EMPTY)) }
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session, controller)
                .setAvailableSessionCommands(commands.build())
                .setMediaButtonPreferences(buttons())
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                COMMAND_SKIP_BACK -> engine.skipBy(-SKIP_MS)
                COMMAND_SKIP_FORWARD -> engine.skipBy(SKIP_MS)
                COMMAND_SHUFFLE -> engine.setShuffle(!engine.shuffle)
                COMMAND_REPEAT -> engine.setRepeat(engine.repeat.next)
                else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }

    /**
     * The player the session shows to the lock screen, the notification, headsets and [MediaPlayerController]. It reads
     * position, length and metadata from ExoPlayer, reports the engine's shuffle and repeat, always offers Next and Previous
     * while a song is loaded, and sends every command to the engine. Changing the playlist from outside is not offered.
     */
    private class SessionPlayer(player: Player, private val engine: PlaybackEngine) : ForwardingSimpleBasePlayer(player) {
        fun refresh() = invalidateState()

        override fun getState(): State {
            val state = super.getState()
            val commands = state.availableCommands.buildUpon()
                .removeAll(Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_CHANGE_MEDIA_ITEMS)
                .addAll(Player.COMMAND_SET_SHUFFLE_MODE, Player.COMMAND_SET_REPEAT_MODE, Player.COMMAND_PLAY_PAUSE)
                .addIf(Player.COMMAND_SEEK_TO_NEXT, engine.current != null)
                .addIf(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, engine.current != null)
                .addIf(Player.COMMAND_SEEK_TO_PREVIOUS, engine.current != null)
                .addIf(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, engine.current != null)
                .build()
            val repeat = when (engine.repeat) {
                RepeatMode.Off -> Player.REPEAT_MODE_OFF
                RepeatMode.All -> Player.REPEAT_MODE_ALL
                RepeatMode.One -> Player.REPEAT_MODE_ONE
            }
            return state.buildUpon()
                .setAvailableCommands(commands)
                .setRepeatMode(repeat)
                .setShuffleModeEnabled(engine.shuffle)
                .build()
        }

        override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
            if (playWhenReady) engine.resume() else engine.pause()
            return Futures.immediateVoidFuture()
        }

        override fun handleStop(): ListenableFuture<*> {
            engine.pause()
            return Futures.immediateVoidFuture()
        }

        override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
            when (seekCommand) {
                Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> engine.next()
                Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> engine.previous()
                else -> engine.seekTo(if (positionMs == C.TIME_UNSET) 0 else positionMs)
            }
            return Futures.immediateVoidFuture()
        }

        override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
            engine.setRepeat(
                when (repeatMode) {
                    Player.REPEAT_MODE_ALL -> RepeatMode.All
                    Player.REPEAT_MODE_ONE -> RepeatMode.One
                    else -> RepeatMode.Off
                },
            )
            return Futures.immediateVoidFuture()
        }

        override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> {
            engine.setShuffle(shuffleModeEnabled)
            return Futures.immediateVoidFuture()
        }
    }

    companion object {
        private const val TAG = "PlaybackService"
        private const val TICK_MS = 500L
        private const val SKIP_MS = 10_000L

        /** AND-067: how long the service stays after a pause while the app is in the background. */
        const val IDLE_STOP_MS = 10 * 60_000L

        /** The notification channel of the media notification. */
        const val CHANNEL_ID = "playback"

        /** Custom session command: seek 10 s back. */
        const val COMMAND_SKIP_BACK = "com.alexisayenko.audioplayer.android.SKIP_BACK_10"

        /** Custom session command: seek 10 s forward. */
        const val COMMAND_SKIP_FORWARD = "com.alexisayenko.audioplayer.android.SKIP_FORWARD_10"

        /** Custom session command: turn shuffle on or off. */
        const val COMMAND_SHUFFLE = "com.alexisayenko.audioplayer.android.TOGGLE_SHUFFLE"

        /** Custom session command: switch repeat to the next mode (off, whole list, one song). */
        const val COMMAND_REPEAT = "com.alexisayenko.audioplayer.android.CYCLE_REPEAT"

        private val CUSTOM_COMMANDS = listOf(COMMAND_SKIP_BACK, COMMAND_SKIP_FORWARD, COMMAND_SHUFFLE, COMMAND_REPEAT)

        /** What the service needs from the app; `App.onCreate` sets it before anything else can run. */
        @Volatile
        var environment: PlaybackEnvironment? = null
    }
}
