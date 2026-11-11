package com.alexisayenko.audioplayer.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import com.alexisayenko.audioplayer.android.AppGraph
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.data.SyncStatus
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.playback.PlayerController
import com.alexisayenko.audioplayer.android.playback.PlayerState
import com.alexisayenko.audioplayer.android.preview.FakeAccount
import com.alexisayenko.audioplayer.android.preview.FakeGraph
import com.alexisayenko.audioplayer.android.preview.FakeLibrary
import com.alexisayenko.audioplayer.android.preview.SampleSongs
import com.alexisayenko.audioplayer.android.ui.library.LibraryScreen
import com.alexisayenko.audioplayer.android.ui.library.SongDetailsSheet
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The Library, its sheets, the row menu and Song details on the in-memory fakes, in every state a row can have. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = PHONE)
class LibraryScreenshotTest {
    @get:Rule val compose = createComposeRule()

    /** "What Is Love" is playing: its row is the highlighted one. */
    private val playing = PlayerState(queue = SampleSongs.all.take(4), index = 0, isPlaying = true, positionMs = 96_000, durationMs = 268_000)
    private val idle = PlayerState()
    private val phoneSongs = SampleSongs.all.filter { it.id in SampleSongs.onPhone }
    private val searchField = "Search songs, artists and tags"

    private fun graph(library: FakeLibrary = FakeLibrary(), signedIn: Boolean = true, state: PlayerState = playing): FakeGraph =
        FakeGraph(library = library, player = StillPlayer(state), account = if (signedIn) FakeAccount() else FakeAccount(session = null))

    private fun emptyLibrary(status: SyncStatus = SyncStatus(synced = true, reachable = true)) =
        FakeLibrary(songs = emptyList(), phone = emptySet(), transfers = emptyMap(), status = status)

    /**
     * Renders [content] like `shoot`, but captures the whole screen: a bottom sheet or a dialog lives in its own
     * window, which the root of the page under it does not include.
     */
    private fun show(graph: AppGraph, dark: Boolean = false, content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers(if (dark) "+night" else "+notnight")
        compose.setContent {
            ElectrophoneTheme(dark = dark) { CompositionLocalProvider(LocalAppGraph provides graph, content = content) }
        }
        compose.waitForIdle()
    }

    private fun library(graph: AppGraph = graph(), dark: Boolean = false) = show(graph, dark) { LibraryScreen(onAdd = {}, onEdit = {}) }

    private fun capture(name: String, dark: Boolean = false) {
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1_000)
        captureScreenRoboImage("build/outputs/roborazzi/$name${if (dark) "-dark" else ""}.png")
    }

    private fun row(title: String) = compose.onNode(hasContentDescription(title, substring = true))

    @Test fun full() {
        library()
        capture("library")
    }

    @Test fun fullDark() {
        library(dark = true)
        capture("library", dark = true)
    }

    @Test fun nothingPlaying() {
        library(graph(state = idle))
        capture("library-idle")
    }

    @Test fun searchWithResults() {
        library()
        compose.onNodeWithContentDescription(searchField).performTextInput("trance")
        capture("library-search")
    }

    @Test fun searchWithoutResults() {
        library()
        compose.onNodeWithContentDescription(searchField).performTextInput("zzz")
        capture("library-search-none")
    }

    @Test fun downloadedOnly() {
        library()
        compose.onNodeWithContentDescription("Downloaded").performScrollTo().performClick()
        capture("library-downloaded")
    }

    @Test fun genresSheetWithTwoPicked() {
        library()
        compose.onNodeWithContentDescription("Genres").performClick()
        compose.onNodeWithContentDescription("trance, 1 song").performClick()
        compose.onNodeWithContentDescription("techno, 1 song").performClick()
        capture("library-sheet-genres")
        compose.onNode(hasText("Done")).performClick()
        capture("library-filtered")
    }

    @Test fun genresSheetDark() {
        library(dark = true)
        compose.onNodeWithContentDescription("Genres").performClick()
        compose.onNodeWithContentDescription("trance, 1 song").performClick()
        capture("library-sheet-genres", dark = true)
    }

    @Test fun decadesSheet() {
        library()
        compose.onNodeWithContentDescription("Decades").performClick()
        compose.onNodeWithContentDescription("1980s, 1 song").performClick()
        capture("library-sheet-decades")
    }

    @Test fun countriesSheet() {
        library()
        compose.onNodeWithContentDescription("Countries").performClick()
        capture("library-sheet-countries")
    }

    @Test fun tagsSheetWithNoTags() {
        library()
        compose.onNodeWithContentDescription("Tags").performClick()
        capture("library-sheet-tags")
    }

    @Test fun sortSheet() {
        library()
        compose.onNodeWithContentDescription("Sort by, Recently added").performClick()
        capture("library-sheet-sort")
    }

    @Test fun sortedByTitleReversed() {
        library()
        compose.onNodeWithContentDescription("Sort by, Recently added").performClick()
        compose.onNode(hasText("Title")).performClick()
        compose.onNodeWithContentDescription("Sort direction, ascending").performClick()
        capture("library-sorted")
    }

    @Test fun actionsSheet() {
        library()
        compose.onNodeWithContentDescription("Library actions").performClick()
        capture("library-sheet-actions")
    }

    @Test fun longPressMenu() {
        library()
        row("LSD, Hallucinogen").performTouchInput { longClick() }
        capture("library-menu")
    }

    @Test fun longPressMenuOfServerSongDark() {
        library(dark = true)
        compose.onNodeWithContentDescription(searchField).performTextInput("window")
        row("Windowlicker").performTouchInput { longClick() }
        capture("library-menu-server", dark = true)
    }

    @Test fun tapPlaysTheListedPhoneSongsFromTheTappedOne() {
        var played: Pair<List<String>, Int>? = null
        val player = object : PlayerController by StillPlayer(idle) {
            override fun play(songs: List<Song>, startIndex: Int) {
                played = songs.map { it.id } to startIndex
            }
        }
        show(FakeGraph(player = player)) { LibraryScreen(onAdd = {}, onEdit = {}) }
        row("Blue Monday").performClick()
        // Listed order (no dates in the samples: by title): Around the World, Blue Monday, LSD, What Is Love.
        assertEquals(listOf("s4", "s3", "s2", "s1") to 1, played)
    }

    @Test fun tapOnServerSongOpensDetails() {
        library()
        compose.onNodeWithContentDescription(searchField).performTextInput("window")
        row("Windowlicker").performClick()
        capture("library-details-server")
    }

    @Test fun removeFromPhoneAsksFirst() {
        library()
        val actions = row("LSD, Hallucinogen").fetchSemanticsNode().config[SemanticsActions.CustomActions]
        compose.runOnUiThread { actions.first { it.label == "Remove from phone" }.action() }
        capture("library-remove-confirm")
    }

    @Test fun signedOutWithPhoneSongs() {
        library(graph(FakeLibrary(songs = phoneSongs, transfers = emptyMap(), status = SyncStatus()), signedIn = false))
        capture("library-signed-out")
    }

    @Test fun signedOutEmpty() {
        library(graph(emptyLibrary(SyncStatus()), signedIn = false, state = idle))
        capture("library-signed-out-empty")
    }

    @Test fun signedOutEmptyDark() {
        library(graph(emptyLibrary(SyncStatus()), signedIn = false, state = idle), dark = true)
        capture("library-signed-out-empty", dark = true)
    }

    @Test fun signedInEmpty() {
        library(graph(emptyLibrary(), state = idle))
        capture("library-empty")
    }

    @Test fun loading() {
        library(graph(emptyLibrary(SyncStatus(syncing = true)), state = idle))
        capture("library-loading")
    }

    @Test fun cannotReachTheServer() {
        library(graph(emptyLibrary(SyncStatus(reachable = false, message = "No connection")), state = idle))
        capture("library-failed")
    }

    @Test fun offlineBanner() {
        library(graph(FakeLibrary(status = SyncStatus(synced = true, reachable = false))))
        capture("library-offline")
    }

    @Test fun expiredSignInBannerDark() {
        library(graph(FakeLibrary(status = SyncStatus(synced = true, reachable = true, unauthorized = true))), dark = true)
        capture("library-expired", dark = true)
    }

    private val detailed = SampleSongs.all.first().copy(
        tags = listOf("genre:eurodance", "country:DE", "decade:1990s", "party", "one-hit wonder"),
        wikipediaSong = "https://en.wikipedia.org/wiki/What_Is_Love_(Haddaway_song)",
        wikipediaArtist = "https://en.wikipedia.org/wiki/Haddaway",
    )

    private fun details(dark: Boolean) {
        val songs = listOf(detailed) + SampleSongs.all.drop(1)
        show(graph(FakeLibrary(songs = songs), state = idle), dark) { SongDetailsSheet(detailed, onDismiss = {}, onEdit = {}) }
        capture("library-details", dark)
    }

    @Test fun songDetails() = details(dark = false)

    @Test fun songDetailsDark() = details(dark = true)

    @Test fun songDetailsWhileDownloading() {
        show(graph()) { SongDetailsSheet(SampleSongs.all[4], onDismiss = {}, onEdit = {}) }
        capture("library-details-downloading")
    }

    @Test fun largeText() {
        RuntimeEnvironment.setFontScale(1.6f)
        try {
            library()
            capture("library-large-text")
        } finally {
            RuntimeEnvironment.setFontScale(1f)
        }
    }
}
