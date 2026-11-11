package com.alexisayenko.audioplayer.android.ui.songform

import com.alexisayenko.audioplayer.android.data.Library
import com.alexisayenko.audioplayer.android.data.Outcome
import com.alexisayenko.audioplayer.android.logic.fixture
import com.alexisayenko.audioplayer.android.model.Preview
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.model.SongVersion
import com.alexisayenko.audioplayer.android.preview.FakeLibrary
import com.alexisayenko.audioplayer.android.preview.SampleSongs
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* The form's payloads against `server/tests/fixtures/ios_contract.json` (the bodies the iPhone sends) and the rule of task-0127 phase 4: a song opened in Edit and saved untouched does not change. */

private fun json(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is List<*> -> JsonArray(value.map(::json))
    is Map<*, *> -> JsonObject(value.entries.associate { it.key as String to json(it.value) })
    else -> error("unsupported payload value $value")
}

private class PreviewLibrary(private val result: Outcome<Preview>, private val inner: FakeLibrary = FakeLibrary()) : Library by inner {
    var added: Pair<Song, Boolean>? = null
    var addResult: Outcome<Song>? = null

    override suspend fun preview(url: String): Outcome<Preview> = result

    override suspend fun add(song: Song, download: Boolean): Outcome<Song> {
        added = song to download
        return addResult ?: Outcome.Ok(song)
    }
}

class SongFormStateTest {
    private val requests = fixture<JsonObject>("ios_contract").getValue("requests").jsonObject

    private val rich = Song(
        id = "abc", title = "Pjanoo - Club Mix", artist = "Eric Prydz, Someone", album = "Pjanoo", remixer = "Club Mix", year = 2008,
        duration = 451.0, thumbnail = "/covers/abc", tags = listOf("genre:house", "country:se", "decade:00s", "piano", "lang:en"),
        bpm = 126.4, sourceURL = "https://www.youtube.com/watch?v=abc", wikipediaSong = "https://en.wikipedia.org/wiki/Pjanoo",
        wikipediaArtist = "https://en.wikipedia.org/wiki/Eric_Prydz", musicbrainzURL = "https://musicbrainz.org/recording/1",
        version = SongVersion(type = "remix", name = "Club Mix"), mainArtists = listOf("Eric Prydz"), featuredArtists = listOf("Someone"),
        releaseYear = 2008, genres = listOf("House"), onServer = true,
    )

    @Test fun addMetadataIsTheBodyTheIphoneSends() {
        val form = AddSongState()
        form.title = "Song"
        form.artist = "Band"
        assertEquals(requests.getValue("add").jsonObject.getValue("metadata"), json(form.addMetadata()))
        assertEquals(requests.getValue("add").jsonObject.getValue("tags"), json(form.commitPending()))
    }

    @Test fun addMetadataSendsBlankOptionalFieldsAsNull() {
        val form = AddSongState()
        form.title = "Song"
        form.remixer = "  "
        form.year = " 1999 "
        form.wikiSong = " "
        val meta = form.addMetadata()
        assertNull(meta["remixer"])
        assertEquals(1999, meta["year"])
        assertNull(meta["wikipedia_song"])
        assertTrue(meta.containsKey("musicbrainz_url"))
    }

    @Test fun editOfEveryFieldIsTheBodyTheIphoneSends() {
        val form = SongFormState(Song(id = "x", title = "Old", artist = "Old", album = "Album", remixer = "Mix", year = 1999, tags = listOf("genre:rock")))
        form.title = "Song"
        form.artist = "Band"
        form.album = ""
        form.remixer = ""
        form.year = ""
        form.tags = emptyList()
        assertEquals(requests.getValue("edit"), json(form.editPayload()))
    }

    @Test fun anUntouchedEditSendsNoCreditKeys() {
        for (song in SampleSongs.all + rich) {
            val payload = SongFormState(song).editPayload()
            assertEquals(song.id, setOf("title", "wikipedia_song", "wikipedia_artist", "musicbrainz_url", "tags"), payload.keys)
            assertEquals(song.title, payload["title"])
            assertEquals(song.tags ?: emptyList<String>(), payload["tags"])
            assertEquals(song.wikipediaSong, payload["wikipedia_song"])
            assertTrue(requests.getValue("edit").jsonObject.keys.containsAll(payload.keys))
        }
    }

    @Test fun anUnchangedSongRoundTripsThroughEdit() {
        val bare = Song(id = "bare", title = "Bare")
        val blankLinks = Song(id = "b", title = "T", artist = " A ", album = "", wikipediaSong = "", tags = emptyList())
        for (song in SampleSongs.all + rich + bare + blankLinks) {
            val form = SongFormState(song)
            assertFalse(song.id, form.hasChanges)
            assertEquals(song, form.toSong(song))
        }
    }

    @Test fun editChangesOnlyWhatThePersonChanged() {
        val form = SongFormState(rich)
        form.album = "Pjanoo EP"
        assertTrue(form.hasChanges)
        assertEquals(mapOf("title" to rich.title, "album" to "Pjanoo EP"), form.editChanges())
        assertEquals(rich.copy(album = "Pjanoo EP"), form.toSong(rich))
    }

    @Test fun aClearedRemixAndYearAreSentAsNull() {
        val form = SongFormState(rich)
        form.remixer = " "
        form.year = ""
        val changes = form.editChanges()
        assertTrue(changes.containsKey("remixer") && changes["remixer"] == null)
        assertTrue(changes.containsKey("year") && changes["year"] == null)
        val saved = form.toSong(rich)
        assertNull(saved.remixer)
        assertNull(saved.year)
    }

    @Test fun aCoverOrLiveVersionLocksTheRemixText() {
        val cover = rich.copy(version = SongVersion(type = "cover", originalArtists = listOf("Nirvana")), remixer = "Cover")
        val form = SongFormState(cover)
        assertTrue(form.remixLocked)
        assertEquals("Cover of Nirvana", form.versionSummary)
        form.remixer = ""
        assertFalse(form.editChanges().containsKey("remixer"))
        assertEquals("Cover", form.toSong(cover).remixer)
        assertEquals("Live: Royal Albert Hall", SongFormState(rich.copy(version = SongVersion(type = "live", name = " Royal Albert Hall "))).versionSummary)
        assertFalse(SongFormState(rich).remixLocked)
        assertEquals("Featuring Someone", SongFormState(rich).featuredSummary)
    }

    @Test fun theYearMovesTheDecadeTag() {
        val form = SongFormState(rich)
        form.year = "1994"
        assertEquals(listOf("genre:house", "country:se", "decade:90s", "piano", "lang:en"), form.tags)
        form.year = ""
        assertEquals("a cleared year leaves the decade as it was", "decade:90s", form.tags[2])
    }

    @Test fun openingASongDoesNotTouchItsDecadeTag() {
        assertEquals(rich.tags, SongFormState(rich).tags)
    }

    @Test fun commitPendingTakesTypedChipsAndKeepsTheCaps() {
        val form = SongFormState(Song(id = "x", title = "T", tags = listOf("country:de")))
        form.pendingGenre = "Rock / pop, rock"
        form.pendingCountry = "France"
        form.pendingTag = "live, mood:"
        assertEquals(listOf("country:de", "genre:rock", "genre:pop", "live"), form.commitPending())
        assertEquals("", form.pendingGenre)
        assertEquals("", form.pendingCountry)
    }

    @Test fun theHintOffersOnlyWhatDiffersAndIsAppliedOnRequest() {
        val form = SongFormState(rich)
        assertNull(form.hint)
        form.suggest = SongSuggest(artist = "eric prydz, someone", title = "Pjanoo")
        assertEquals(SongHint(null, "Pjanoo"), form.hint)
        form.applyHint()
        assertEquals("Pjanoo", form.title)
        assertEquals(rich.artist, form.artist)
        assertNull(form.suggest)
    }

    @Test fun commitNamespacedSplitsAndRefuses() {
        assertEquals(NamespacedCommit(listOf("genre:rock", "genre:pop"), "ja", null), commitNamespaced(emptyList(), "genre", 12, "Rock/pop, ja", final = false))
        assertEquals(NamespacedCommit(emptyList(), "", "Unknown country"), commitNamespaced(emptyList(), "country", 1, "Atlantis"))
        assertEquals(NamespacedCommit(listOf("country:de"), "", "Up to 1"), commitNamespaced(listOf("country:de"), "country", 1, "France"))
        assertEquals(listOf("a", "B"), finalTags(listOf("a"), "A, B, k:"))
    }

    @Test fun fetchFillsTheFormAndAddSavesThePreviewSong() = runTest {
        val preview = Preview(
            id = "vid", source = "youtube", source_url = "https://www.youtube.com/watch?v=vid", title = "One More Time", artist = "Daft Punk",
            album = "Discovery", remixer = null, year = 2000, duration = 320.0, thumbnail = "https://i.ytimg.com/vi/vid/hq.jpg",
            tags = listOf("genre:french house", "country:fr"), wikipedia_song = "https://en.wikipedia.org/wiki/One_More_Time_(Daft_Punk_song)",
        )
        val library = PreviewLibrary(Outcome.Ok(preview))
        val form = AddSongState("look https://youtu.be/vid?si=abc")
        form.loadPreview(library)
        assertEquals(AddSongState.Phase.Ready, form.phase)
        assertTrue(form.hasPreview)
        assertEquals("One More Time", form.title)
        assertEquals(listOf("genre:french house", "country:fr", "decade:00s"), form.tags)
        assertEquals(form.tags, form.suggested)
        form.pendingGenre = "House"
        assertTrue(form.save(library, download = true))
        assertEquals(AddSongState.Phase.Saved, form.phase)
        val (song, download) = checkNotNull(library.added)
        assertTrue(download)
        assertEquals(
            Song(
                id = "vid", title = "One More Time", artist = "Daft Punk", duration = 320.0, thumbnail = "/covers/vid", album = "Discovery", year = 2000,
                tags = listOf("genre:french house", "country:fr", "decade:00s", "genre:house"), sourceURL = "https://www.youtube.com/watch?v=vid",
                wikipediaSong = "https://en.wikipedia.org/wiki/One_More_Time_(Daft_Punk_song)",
            ),
            song,
        )
    }

    @Test fun aFailedFetchKeepsTheLinkAndShowsTheServersWords() = runTest {
        val form = AddSongState("https://example.com/x")
        form.loadPreview(PreviewLibrary(Outcome.Failed("Unsupported link")))
        assertEquals(AddSongState.Phase.Idle, form.phase)
        assertEquals("Unsupported link", form.message)
        assertFalse(form.hasPreview)
        assertFalse(form.save(PreviewLibrary(Outcome.Failed("x")), download = false))
    }

    @Test fun aFailedSaveCanBeTriedAgain() = runTest {
        val library = PreviewLibrary(Outcome.Ok(Preview(id = "vid", title = "T")))
        val form = AddSongState("https://youtu.be/vid")
        form.loadPreview(library)
        library.addResult = Outcome.Failed("Library is full")
        assertFalse(form.save(library, download = false))
        assertEquals(AddSongState.Phase.Failed, form.phase)
        assertEquals("Library is full", form.message)
        library.addResult = null
        assertTrue(form.save(library, download = false))
    }

    @Test fun aPasteIsCleanedAtOnceAndTypingIsLeftAlone() {
        val form = AddSongState()
        form.onUrlInput("h")
        assertEquals("h", form.url)
        form.onUrlInput("Watch this: https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&si=zz")
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", form.url)
    }
}
