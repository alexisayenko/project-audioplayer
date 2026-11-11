package com.alexisayenko.audioplayer.android.ui

import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import com.alexisayenko.audioplayer.android.playback.PlayerState
import com.alexisayenko.audioplayer.android.playback.RepeatMode
import com.alexisayenko.audioplayer.android.preview.FakeGraph
import com.alexisayenko.audioplayer.android.preview.SampleSongs
import com.alexisayenko.audioplayer.android.ui.playback.PlaybackContent
import com.alexisayenko.audioplayer.android.ui.playback.PlaybackScreen
import com.alexisayenko.audioplayer.android.ui.playback.PlaybackSeek
import com.alexisayenko.audioplayer.android.ui.playback.formatTime
import com.alexisayenko.audioplayer.android.ui.shell.AppShell
import com.alexisayenko.audioplayer.android.ui.shell.AppTab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Pictures of the Now playing screen in its main states, and the two small rules behind the seek bar. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = PHONE)
class PlaybackScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val queue = SampleSongs.all.take(6)
    private val playing = PlayerState(queue = queue, index = 1, isPlaying = true, positionMs = 96_000, durationMs = 471_000)
    private val paused = PlayerState(queue = queue, index = 3, isPlaying = false, positionMs = 214_000, durationMs = 429_000, shuffle = true, repeat = RepeatMode.One)

    private fun screen(name: String, state: PlayerState, dark: Boolean = false) =
        compose.shoot(name, FakeGraph(player = StillPlayer(state)), dark) {
            AppShell(library = {}, playback = { PlaybackScreen() }, settings = {}, initialTab = AppTab.Playback)
        }

    @Test fun playing() = screen("playback-playing", playing)

    @Test fun playingDark() = screen("playback-playing", playing, dark = true)

    @Test fun pausedShuffleRepeatOne() = screen("playback-paused", paused)

    @Test fun pausedShuffleRepeatOneDark() = screen("playback-paused", paused, dark = true)

    @Test fun empty() = screen("playback-empty", PlayerState())

    @Test fun emptyDark() = screen("playback-empty", PlayerState(), dark = true)

    @Test fun queueScrolledIntoView() = compose.shoot("playback-queue", FakeGraph(player = StillPlayer(paused))) {
        PlaybackContent(rememberLazyListState(initialFirstVisibleItemIndex = 3))
    }

    @Test fun queueScrolledIntoViewDark() = compose.shoot("playback-queue", FakeGraph(player = StillPlayer(playing.copy(repeat = RepeatMode.All))), dark = true) {
        PlaybackContent(rememberLazyListState(initialFirstVisibleItemIndex = 3))
    }

    @Test fun largeText() = compose.shoot("playback-large-text", FakeGraph(player = StillPlayer(playing))) {
        CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale = 2f)) { PlaybackScreen() }
    }

    @Test fun timeIsMinutesAndSeconds() {
        assertEquals("0:00", formatTime(0L))
        assertEquals("1:36", formatTime(96_000L))
        assertEquals("12:05", formatTime(725.9))
        assertEquals("0:00", formatTime(-3.0))
    }

    @Test fun tapStepsTowardsTheTappedSide() {
        assertEquals(95.0, PlaybackSeek.tapTarget(current = 100.0, duration = 200.0, tapped = 20.0)!!, 0.0)
        assertEquals(105.0, PlaybackSeek.tapTarget(current = 100.0, duration = 200.0, tapped = 180.0)!!, 0.0)
        assertEquals(200.0, PlaybackSeek.tapTarget(current = 198.0, duration = 200.0, tapped = 199.0)!!, 0.0)
        assertEquals(0.0, PlaybackSeek.tapTarget(current = 2.0, duration = 200.0, tapped = 0.0)!!, 0.0)
        assertNull(PlaybackSeek.tapTarget(current = 100.0, duration = 200.0, tapped = 100.0))
        assertNull(PlaybackSeek.tapTarget(current = 0.0, duration = 0.0, tapped = 1.0))
    }
}
