package com.alexisayenko.audioplayer.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import com.alexisayenko.audioplayer.android.LocalAppGraph
import com.alexisayenko.audioplayer.android.data.Library
import com.alexisayenko.audioplayer.android.data.Outcome
import com.alexisayenko.audioplayer.android.model.Preview
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.model.SongVersion
import com.alexisayenko.audioplayer.android.playback.PlayerState
import com.alexisayenko.audioplayer.android.preview.FakeGraph
import com.alexisayenko.audioplayer.android.preview.FakeLibrary
import com.alexisayenko.audioplayer.android.preview.FakeSettings
import com.alexisayenko.audioplayer.android.preview.SampleSongs
import com.alexisayenko.audioplayer.android.ui.songform.AddSongContent
import com.alexisayenko.audioplayer.android.ui.songform.AddSongSheet
import com.alexisayenko.audioplayer.android.ui.songform.AddSongState
import com.alexisayenko.audioplayer.android.ui.songform.EditSongContent
import com.alexisayenko.audioplayer.android.ui.songform.EditSongSheet
import com.alexisayenko.audioplayer.android.ui.songform.SongForm
import com.alexisayenko.audioplayer.android.ui.songform.SongFormState
import com.alexisayenko.audioplayer.android.ui.songform.SongSuggest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** A phone as wide as [PHONE] and tall enough to show the whole form at once, for looking at every field. */
private const val TALL = "w412dp-h1500dp-420dpi"

private class CannedLibrary(private val result: Outcome<Preview>, private val inner: FakeLibrary = FakeLibrary()) : Library by inner {
    var updated: Song? = null

    override suspend fun preview(url: String): Outcome<Preview> = result

    override suspend fun update(song: Song): Outcome<Song> {
        updated = song
        return Outcome.Ok(song)
    }
}

/**
 * The Add and Edit forms rendered on fake services: pictures to look at when recording, and a few taps and typed
 * texts to prove the pill field, the menu and the drag work as a whole under Robolectric.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = PHONE)
class SongFormScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val preview = Preview(
        id = "FGBhQbmPwH8", source = "youtube", source_url = "https://www.youtube.com/watch?v=FGBhQbmPwH8", title = "One More Time",
        artist = "Daft Punk", album = "Discovery", year = 2000, duration = 320.0, tags = listOf("genre:french house", "country:fr", "disco"),
        wikipedia_song = "https://en.wikipedia.org/wiki/One_More_Time_(Daft_Punk_song)", wikipedia_artist = "https://en.wikipedia.org/wiki/Daft_Punk",
    )

    private val sample = Song(
        id = "s9", title = "Insomnia - Monster Mix", artist = "Faithless", remixer = "Rollo | Sister Bliss", album = "Reverence", year = 1995,
        duration = 521.0, bpm = 127.6, tags = listOf("genre:progressive house", "genre:trance", "country:gb", "decade:90s", "club classic", "mood:dark"),
        sourceURL = "https://www.youtube.com/watch?v=P8JEm4d6Wu4", wikipediaSong = "https://en.wikipedia.org/wiki/Insomnia_(Faithless_song)",
        wikipediaArtist = "https://en.wikipedia.org/wiki/Faithless", version = SongVersion(type = "remix", name = "Monster Mix"), onServer = true,
    )

    private fun graph(library: Library = FakeLibrary(), autoDownload: Boolean = true) = FakeGraph(
        library = library,
        player = StillPlayer(PlayerState()),
        settings = FakeSettings().apply { setDownloadNewAutomatically(autoDownload) },
    )

    /** A song filed under its YouTube video id, as the server files it, so a pasted link finds it offline. */
    private val saved = Song(id = "HEXWRTEbj1I", title = "What Is Love", artist = "Haddaway", sourceURL = "https://www.youtube.com/watch?v=HEXWRTEbj1I", onServer = true)

    private fun add(name: String, link: String?, result: Outcome<Preview>? = null, dark: Boolean = false, autoDownload: Boolean = true, edit: AddSongState.() -> Unit = {}) {
        val library = CannedLibrary(result ?: Outcome.Ok(preview), FakeLibrary(songs = listOf(saved) + SampleSongs.all, phone = SampleSongs.onPhone + saved.id))
        val state = AddSongState(link)
        if (result != null) runBlocking { state.loadPreview(library) }
        state.edit()
        compose.shoot(name, graph(library, autoDownload), dark) {
            Box(Modifier.fillMaxSize().statusBarsPadding()) { AddSongContent(link, {}, state = state) }
        }
    }

    private fun edit(name: String, song: Song, dark: Boolean = false, change: SongFormState.() -> Unit = {}) {
        val state = SongFormState(song).apply(change)
        compose.shoot(name, graph(), dark) {
            Box(Modifier.fillMaxSize().statusBarsPadding()) { EditSongContent(song, {}, state = state) }
        }
    }

    @Test fun addEmpty() = add("songform-add-empty", null)

    @Test fun addPastedLink() = add("songform-add-pasted", "Check this out https://youtu.be/FGBhQbmPwH8?si=abc123")

    @Test fun addLibraryMatch() = add("songform-add-match", "https://youtu.be/HEXWRTEbj1I?si=share")

    @Test fun addError() = add("songform-add-error", "https://vimeo.com/12345", Outcome.Failed("Unsupported link. Electrophone takes YouTube and SoundCloud links only."))

    @Test fun addErrorDark() = add("songform-add-error", "https://vimeo.com/12345", Outcome.Failed("Unsupported link. Electrophone takes YouTube and SoundCloud links only."), dark = true)

    @Test fun addPreview() = add("songform-add-preview", preview.source_url, Outcome.Ok(preview))

    @Test fun addPreviewDark() = add("songform-add-preview", preview.source_url, Outcome.Ok(preview), dark = true)

    @Config(qualifiers = TALL)
    @Test fun addPreviewWhole() = add("songform-add-preview-whole", preview.source_url, Outcome.Ok(preview), autoDownload = false) {
        suggest = SongSuggest("Daft Punk", "One More Time (Radio Edit)")
        pendingGenre = "ho"
    }

    @Test fun addPreviewAlreadySaved() = add("songform-add-saved", preview.source_url, Outcome.Ok(preview.copy(id = "s2", in_library = true)))

    @Test fun editSong() = edit("songform-edit", sample)

    @Test fun editSongDark() = edit("songform-edit", sample, dark = true)

    @Config(qualifiers = TALL)
    @Test fun editSongWhole() = edit("songform-edit-whole", sample)

    @Config(qualifiers = TALL)
    @Test fun editSongWholeDark() = edit("songform-edit-whole", sample, dark = true)

    @Config(qualifiers = TALL)
    @Test fun editCoverVersion() = edit(
        "songform-edit-cover",
        sample.copy(title = "Smells Like Teen Spirit", artist = "Tori Amos", remixer = null, bpm = null, tags = emptyList(), wikipediaSong = null, wikipediaArtist = null,
            version = SongVersion(type = "cover", originalArtists = listOf("Nirvana")), featuredArtists = listOf("Someone Else")),
    )

    @Config(qualifiers = "w320dp-h1500dp-420dpi", fontScale = 1.5f)
    @Test fun editSongLargeTextNarrow() = edit("songform-edit-large-text", sample)

    @Test fun sheetsCompose() {
        compose.setContent {
            ElectrophoneTheme {
                CompositionLocalProvider(LocalAppGraph provides graph()) {
                    AddSongSheet("https://youtu.be/FGBhQbmPwH8") {}
                }
            }
        }
        compose.onNodeWithText("Add a song").assertExists()
        compose.onNodeWithText("Fetch").assertExists()
    }

    @Test fun editSheetComposes() {
        compose.setContent {
            ElectrophoneTheme {
                CompositionLocalProvider(LocalAppGraph provides graph()) {
                    EditSongSheet(sample) {}
                }
            }
        }
        compose.onNodeWithText("Song").assertExists()
        compose.onNodeWithContentDescription("Remove Faithless").assertExists()
    }

    private fun form(state: SongFormState) {
        compose.setContent {
            ElectrophoneTheme {
                CompositionLocalProvider(LocalAppGraph provides graph()) {
                    Box(Modifier.padding(DS.Space.space4)) { SongForm(state) }
                }
            }
        }
    }

    @Test fun typingASeparatorMakesAPillAndEnterCommitsTheRest() {
        val state = SongFormState(Song(id = "x", title = ""))
        form(state)
        val entry = compose.onNode(hasContentDescription("Title") and hasSetTextAction())
        entry.performTextInput("Daft Punk - ")
        compose.onNodeWithContentDescription("Remove Daft Punk").assertExists()
        entry.performTextInput("Voyager")
        entry.performImeAction()
        compose.onNodeWithContentDescription("Remove Voyager").assertExists()
        assertEquals("Daft Punk - Voyager", state.title)
    }

    @Test fun thePillMenuMovesAndRemoves() {
        val state = SongFormState(sample)
        form(state)
        compose.onNodeWithContentDescription("Edit Monster Mix").performClick()
        compose.onNodeWithText("Move to Remix").performClick()
        assertEquals("Insomnia", state.title)
        assertEquals("Rollo | Sister Bliss Monster Mix", state.remixer)
        compose.onNodeWithContentDescription("Remove Rollo").performClick()
        assertEquals("Sister Bliss Monster Mix", state.remixer)
    }

    @Test fun thePillMenuEditsThePillText() {
        val state = SongFormState(sample)
        form(state)
        compose.onNodeWithContentDescription("Edit Faithless").performClick()
        compose.onNodeWithText("Edit text").performClick()
        val editor = compose.onNode(hasContentDescription("Edit Faithless") and hasSetTextAction())
        editor.performTextInput("!")
        editor.performImeAction()
        compose.waitForIdle()
        assertEquals(true, state.artist == "!Faithless" || state.artist == "Faithless!")
    }

    @Test fun aLongPressDragMovesAPillToAnotherField() {
        val state = SongFormState(sample)
        form(state)
        val artistEntry = compose.onNode(hasContentDescription("Artist") and hasSetTextAction()).fetchSemanticsNode().boundsInRoot
        val pill = compose.onNode(hasText("Monster Mix")).fetchSemanticsNode().boundsInRoot
        compose.onNode(hasText("Monster Mix")).performTouchInput {
            down(center)
            advanceEventTime(viewConfiguration.longPressTimeoutMillis + 100)
            val by = Offset(artistEntry.center.x - pill.center.x, artistEntry.center.y - pill.center.y)
            moveBy(Offset(by.x / 2, by.y / 2))
            moveBy(Offset(by.x / 2, by.y / 2))
            up()
        }
        compose.waitForIdle()
        assertEquals("Insomnia", state.title)
        assertEquals("Faithless, Monster Mix", state.artist)
    }

    @Test fun genresTakeTypedTextAndSuggestions() {
        val state = SongFormState(Song(id = "x", title = "T"))
        form(state)
        val field = compose.onNode(hasText("Add a genre") or (hasContentDescription("Add a genre") and hasSetTextAction()))
        field.performTextInput("Rock, tr")
        assertEquals(listOf("genre:rock"), state.tags)
        compose.onNodeWithText("trance").performClick()
        assertEquals(listOf("genre:rock", "genre:trance"), state.tags)
    }

    @Test fun saveSendsTheEditedSongAndAnEmptyTitleBlocksSave() {
        val library = CannedLibrary(Outcome.Ok(preview))
        val state = SongFormState(sample)
        var closed = false
        compose.setContent {
            ElectrophoneTheme {
                CompositionLocalProvider(LocalAppGraph provides graph(library)) { EditSongContent(sample, { closed = true }, state = state) }
            }
        }
        compose.onNodeWithContentDescription("Remove Monster Mix").performClick()
        compose.onNodeWithText("Save").performClick()
        compose.waitForIdle()
        assertEquals(sample.copy(title = "Insomnia"), library.updated)
        assertEquals(true, closed)
        state.title = ""
        compose.onNodeWithText("Save").assertIsNotEnabled()
    }
}
