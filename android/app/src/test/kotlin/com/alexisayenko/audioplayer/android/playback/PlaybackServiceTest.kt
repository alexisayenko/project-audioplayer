package com.alexisayenko.audioplayer.android.playback

import android.os.Looper
import androidx.media3.common.Player
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The wiring of the service under Robolectric: the session's player routes the lock-screen commands to the queue engine,
 * the state reaches [PlaybackHub], and a second start restores the saved queue paused. No sound is decoded here (the files
 * are not audio); what a device does with the notification, audio focus and headsets is not covered.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PlaybackServiceTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val a = Song("a", "A", artist = "One", album = "LP", duration = 200.0)
    private val b = Song("b", "B", artist = "Two", duration = 200.0)
    private val c = Song("c", "C", artist = "Three", duration = 200.0)
    private val library = listOf(a, b, c).associateBy { it.id }
    private val events = mutableListOf<PlaybackEvent>()
    private val scope = CoroutineScope(Dispatchers.Unconfined)

    private fun audio(id: String) = File(context.filesDir, "audio/$id.m4a")

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    @Before
    fun setUp() {
        for (id in listOf("a", "b")) {
            audio(id).parentFile!!.mkdirs()
            audio(id).writeBytes(ByteArray(64))
        }
        PlaybackService.environment = object : PlaybackEnvironment {
            override fun fileFor(songId: String): File? = audio(songId)
            override fun coverFor(song: Song): File? = null
            override fun listenCounts(): Map<String, Int>? = null
            override fun song(id: String): Song? = library[id]
            override suspend fun awaitLibrary() = Unit
            override val playSink = PlaySink { _, _ -> null }
        }
        scope.launch { PlaybackHub.events.collect { events += it } }
    }

    @After
    fun tearDown() {
        scope.cancel()
        PlaybackService.environment = null
    }

    @Test
    fun theSessionDrivesTheQueueAndARestartRestoresItPaused() {
        val first = Robolectric.buildService(PlaybackService::class.java).create()
        idle()
        val session = first.get().session
        val player = session.player
        assertEquals(4, session.mediaButtonPreferences.size)

        PlaybackHub.submit { it.play(listOf(a, c, b), 0) }
        var state = PlaybackHub.state.value
        assertEquals(listOf(a, c, b), state.queue)
        assertEquals(a, state.current)
        assertTrue(state.isPlaying)
        assertEquals("a", player.currentMediaItem?.mediaId)
        assertEquals("file", player.currentMediaItem?.localConfiguration?.uri?.scheme)
        assertEquals("A", player.mediaMetadata.title)
        assertEquals("One", player.mediaMetadata.artist)
        assertEquals("LP", player.mediaMetadata.albumTitle)
        assertEquals(1, player.mediaItemCount)

        // The lock screen always has Next and Previous, although ExoPlayer holds one song.
        assertTrue(player.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT))
        assertTrue(player.isCommandAvailable(Player.COMMAND_SEEK_TO_PREVIOUS))
        assertFalse(player.isCommandAvailable(Player.COMMAND_CHANGE_MEDIA_ITEMS))

        // Next from the session: c has no file, so it is skipped and reported, and b plays.
        player.seekToNext()
        state = PlaybackHub.state.value
        assertEquals(b, state.current)
        assertEquals("b", player.currentMediaItem?.mediaId)
        assertEquals(listOf<PlaybackEvent>(PlaybackEvent.SkippedMissing(listOf(c))), events)

        player.seekToPrevious()
        assertEquals(a, PlaybackHub.state.value.current)

        player.repeatMode = Player.REPEAT_MODE_ALL
        player.shuffleModeEnabled = true
        state = PlaybackHub.state.value
        assertEquals(RepeatMode.All, state.repeat)
        assertTrue(state.shuffle)
        assertEquals(Player.REPEAT_MODE_ALL, player.repeatMode)
        assertTrue(player.shuffleModeEnabled)
        player.shuffleModeEnabled = false

        player.pause()
        assertFalse(PlaybackHub.state.value.isPlaying)
        player.play()
        assertTrue(PlaybackHub.state.value.isPlaying)
        PlaybackHub.submit { it.seekTo(42_000) } // the screens seek through the hub; the files here are not real audio
        assertEquals(42_000L, PlaybackHub.state.value.positionMs)
        player.pause()

        first.destroy()
        assertNull(PlaybackHub.engine)
        assertFalse(PlaybackHub.state.value.isPlaying)

        // A new start: the saved queue comes back paused, without the song whose file is missing, at the saved position.
        var early = false
        PlaybackHub.submit { early = true }
        assertFalse(early) // commands wait for the service
        val second = Robolectric.buildService(PlaybackService::class.java).create()
        idle()
        assertTrue(early)
        state = PlaybackHub.state.value
        assertEquals(listOf(a, b), state.queue)
        assertEquals(a, state.current)
        assertFalse(state.isPlaying)
        assertEquals(42_000L, state.positionMs)
        assertEquals(RepeatMode.All, state.repeat)
        val restored = second.get().session.player
        assertEquals("a", restored.currentMediaItem?.mediaId)
        assertFalse(restored.playWhenReady)
        assertEquals(Player.STATE_IDLE, restored.playbackState) // cued, not prepared: no notification until Play
        second.destroy()
    }
}
