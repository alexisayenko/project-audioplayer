package com.alexisayenko.audioplayer.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import com.alexisayenko.audioplayer.android.playback.PlayerController
import com.alexisayenko.audioplayer.android.playback.PlayerState
import com.alexisayenko.audioplayer.android.playback.RepeatMode
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.preview.FakeGraph
import com.alexisayenko.audioplayer.android.preview.SampleSongs
import com.alexisayenko.audioplayer.android.ui.shell.AppShell
import com.alexisayenko.audioplayer.android.ui.shell.ScreenHeader
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

private class StillPlayer(state: PlayerState) : PlayerController {
    override val state = MutableStateFlow(state)
    override fun play(songs: List<Song>, startIndex: Int) {}
    override fun playAll(songs: List<Song>) {}
    override fun playNow(song: Song) {}
    override fun playNext(song: Song) {}
    override fun enqueue(songs: List<Song>) = 0
    override fun toggle() {}
    override fun pause() {}
    override fun resume() {}
    override fun next() {}
    override fun previous() {}
    override fun seekTo(positionMs: Long) {}
    override fun skipBy(deltaMs: Long) {}
    override fun jumpTo(index: Int) {}
    override fun removeFromQueue(index: Int) {}
    override fun moveQueueItem(from: Int, to: Int) {}
    override fun clearQueue() {}
    override fun setShuffle(on: Boolean) {}
    override fun setRepeat(mode: RepeatMode) {}
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = PHONE)
class ShellScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val playing = PlayerState(queue = SampleSongs.all.take(4), index = 0, isPlaying = true, positionMs = 96_000, durationMs = 268_000)

    private fun shell(name: String, dark: Boolean, drawerOpen: Boolean) {
        compose.shoot(name, FakeGraph(player = StillPlayer(playing)), dark) {
            AppShell(
                library = { Box(Modifier.fillMaxSize().statusBarsPadding().padding(DS.Space.space4)) { ScreenHeader("Library") } },
                playback = {},
                settings = {},
                initialDrawerOpen = drawerOpen,
            )
        }
    }

    @Test fun shellWithMiniPlayer() = shell("shell", dark = false, drawerOpen = false)
    @Test fun drawerOpen() = shell("drawer", dark = false, drawerOpen = true)
    @Test fun drawerOpenDark() = shell("drawer", dark = true, drawerOpen = true)
}
