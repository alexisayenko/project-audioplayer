package com.alexisayenko.audioplayer.android.logic

import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.model.SongSource
import com.alexisayenko.audioplayer.android.model.SongVersion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The cases of `genreSuggestSelfCheck()` in `ios/Sources/GenreSuggest.swift`. */
class GenreSuggestTest {
    private val all = listOf("synthpop", "pop", "k-pop", "pop rock", "indie pop", "rock")

    @Test
    fun selfCheckCases() {
        assertEquals(listOf("pop", "pop rock", "k-pop", "indie pop", "synthpop"), suggestGenres("pop", all))
        assertEquals(listOf("pop rock", "k-pop", "indie pop", "synthpop"), suggestGenres("pop", all, chosen = listOf("Pop")))
        assertEquals(listOf("électro"), suggestGenres("ELEC", listOf("électro", "house")))
        assertEquals(listOf("Électro"), suggestGenres("elec", listOf("Électro")))
        assertEquals(6, suggestGenres("a", listOf("a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8")).size)
        assertEquals(emptyList<String>(), suggestGenres("  ", all))
        assertEquals(emptyList<String>(), suggestGenres("zzz", all))
        assertEquals(listOf("pop", "rock"), genresFromTags(listOf(listOf("genre:Rock", "x"), listOf("genre:pop"), listOf("genre:pop"))))
    }
}

/** The cases of `wikiLinkSelfCheck()` in `ios/Sources/WikiLink.swift`. */
class WikiLinkTest {
    private val w = "https://en.wikipedia.org/wiki/"

    @Test
    fun displayCases() {
        assertEquals("Crazy", wikiDisplay(w + "Crazy"))
        assertEquals("Warrior's Dance", wikiDisplay(w + "Warrior%27s_Dance"))
        assertEquals("The Prodigy", wikiDisplay(w + "The_Prodigy"))
        assertEquals("Foo Bar", wikiDisplay(w + "Foo_Bar#History"))
        assertEquals("Foo", wikiDisplay(w + "Foo?x=1"))
        assertEquals("Foo", wikiDisplay("https://m.EN.wikipedia.org/wiki/Foo"))
        assertEquals("https://de.wikipedia.org/wiki/Foo", wikiDisplay("https://de.wikipedia.org/wiki/Foo"))
        assertEquals("https://www.wikidata.org/wiki/Q1", wikiDisplay("https://www.wikidata.org/wiki/Q1"))
        assertEquals("100% sure", wikiDisplay(w + "100%_sure"))
    }

    @Test
    fun normalizeCases() {
        assertEquals("", wikiNormalize(""))
        assertEquals("", wikiNormalize("  "))
        assertEquals("https://de.wikipedia.org/wiki/Foo", wikiNormalize(" https://de.wikipedia.org/wiki/Foo "))
        assertEquals(w + "Warrior's_Dance", wikiNormalize("Warrior's Dance"))
        assertEquals(w + "Crazy_(Gnarls_Barkley_song)", wikiNormalize("Crazy (Gnarls Barkley song)"))
        assertEquals(w + "AC%2FDC", wikiNormalize("AC/DC"))
    }

    /** Not in the Swift check: letters outside ASCII are escaped as UTF-8 and read back. */
    @Test
    fun nonAsciiNamesRoundTrip() {
        assertEquals(w + "Beyonc%C3%A9", wikiNormalize("Beyoncé"))
        assertEquals("Beyoncé", wikiDisplay(w + "Beyonc%C3%A9"))
        assertEquals("%E9", wikiDisplay(w + "%E9"))
    }

    @Test
    fun wikiLinksAreRecognised() {
        assertTrue(isWikiLink("https://en.wikipedia.org/wiki/Crazy"))
        assertTrue(isWikiLink("https://www.wikidata.org/wiki/Q42"))
        assertFalse(isWikiLink("http://en.wikipedia.org/wiki/Crazy"))
        assertFalse(isWikiLink("https://www.wikidata.org/wiki/Q0"))
        assertFalse(isWikiLink("https://en.wikipedia.org/wiki/Two words"))
    }
}

class SongDisplayTest {
    @Test
    fun legacySongShowsItsArtistAndYear() {
        val song = Song(id = "a", title = "Song", artist = "Artist", year = 1999)
        assertEquals("Song", SongDisplay.titleLine(song))
        assertEquals("Artist", SongDisplay.artistLine(song))
        assertEquals("Artist · 1999", SongDisplay.subtitleLine(song))
        assertEquals("Artist · 1999", SongDisplay.subtitleLineUnbroken(song))
        assertEquals("Artist - Song", SongDisplay.displayLine(song))
        assertEquals("", SongDisplay.versionLine(song))
    }

    @Test
    fun structuredCreditsGiveMainFeaturedAndWith() {
        val song = Song(
            id = "a", title = "Song", artist = "Legacy", year = 1999,
            mainArtists = listOf("A", "B"), featuredArtists = listOf("C", "D"), withArtists = listOf("E"),
        )
        assertEquals("A & B feat. C & D with E", SongDisplay.artistLine(song))
        assertEquals("A & B feat. C & D with E · 1999", SongDisplay.subtitleLine(song))
        assertEquals("A", SongDisplay.artistLine(song.copy(mainArtists = listOf("A"), featuredArtists = emptyList(), withArtists = null)))
    }

    @Test
    fun yearFollowsTheVersionExceptForARemaster() {
        val base = Song(id = "a", title = "Song", artist = "Artist", year = 1984, releaseYear = 1985)
        assertEquals(1985, SongDisplay.year(base))
        assertEquals(2001, SongDisplay.year(base.copy(remixYear = 2001)))
        assertEquals(2024, SongDisplay.year(base.copy(remixYear = 2001, version = SongVersion(type = "remix", releaseYear = 2024))))
        assertEquals(1985, SongDisplay.year(base.copy(version = SongVersion(type = "Remaster", releaseYear = 2024))))
        assertEquals("Artist · 2024", SongDisplay.subtitleLine(base.copy(version = SongVersion(type = "live", releaseYear = 2024))))
    }

    @Test
    fun missingPartsAreLeftOut() {
        assertEquals("", SongDisplay.subtitleLine(Song(id = "a", title = "Song")))
        assertEquals("2001", SongDisplay.subtitleLine(Song(id = "a", title = "Song", year = 2001)))
        assertEquals("Artist", SongDisplay.subtitleLine(Song(id = "a", title = "Song", artist = "Artist")))
        assertEquals("Song", SongDisplay.displayLine(Song(id = "a", title = "Song")))
    }

    @Test
    fun versionLinePrefersTheNameThenTheKind() {
        val song = Song(id = "a", title = "Song")
        assertEquals("Night Mix", SongDisplay.versionLine(song.copy(version = SongVersion(type = "remix", name = "Night Mix"))))
        assertEquals("Remix", SongDisplay.versionLine(song.copy(version = SongVersion(type = "remix"))))
        assertEquals("", SongDisplay.versionLine(song.copy(version = SongVersion())))
    }
}

/** Tag helpers that have no shared case file. */
class TagHelpersTest {
    @Test
    fun labelsReadLikeWords() {
        assertEquals("the 90s", tagLabel("decade:90s"))
        assertEquals("Lithuania", tagLabel("country:lt"))
        assertEquals("German", tagLabel("lang:de"))
        assertEquals("house", tagLabel("genre:house"))
        assertEquals("plain", tagLabel("plain"))
        assertEquals("notacountry", tagLabel("country:notacountry"))
        assertEquals("genre", tagKey("Genre:House"))
        assertEquals("", tagKey("plain"))
    }

    @Test
    fun countryCodeTakesNamesAndCodes() {
        assertEquals("lt", countryCode("LT"))
        assertEquals("lt", countryCode(" lithuania "))
        assertNull(countryCode("Atlantis"))
        assertNull(countryCode("  "))
        assertNull(countryCode("zq"))
    }

    @Test
    fun countsAndGroups() {
        val counts = tagCounts(listOf(listOf("genre:House", "live"), listOf("genre:house", "decade:00s", "lang:en"), listOf("decade:90s", "mood:calm")))
        assertEquals(TagCount("genre:House", 2), counts.first { it.tag.startsWith("genre") })
        val groups = tagGroups(counts)
        assertEquals(listOf("genre", "decade", "mood", ""), groups.map { it.key })
        assertEquals(listOf("Genre", "Decade", "Mood", "Tags"), groups.map { it.name })
        assertEquals(listOf("decade:90s", "decade:00s"), groups[1].tags.map { it.tag })
    }

    @Test
    fun addNamespacedHoldsTheCapsAndSkipsDuplicates() {
        val added = addNamespaced(listOf("genre:house", "country:lt"), listOf("Genre:House", "genre:Pop", "country:se", "mood:calm", "plain"))
        assertEquals(listOf("genre:house", "country:lt", "genre:pop"), added)
        val full = (1..GENRE_CAP).map { "genre:g$it" }
        assertEquals(full, addNamespaced(full, listOf("genre:extra")))
        assertTrue(hasTag(listOf("Genre:House"), "genre:house"))
    }

    @Test
    fun sourceAndYearHelpers() {
        assertEquals("SoundCloud", sourceLabel("soundcloud"))
        assertEquals("Apple Music", sourceLabel("applemusic"))
        assertEquals("YouTube", sourceLabel(null))
        assertEquals("spotify", Song(id = "spotify-1", title = "T").source)
        assertEquals(2024, displayYear(1980, versionYear = 2024))
        assertEquals(1980, displayYear(1980, versionYear = null))
    }

    @Test
    fun libraryMatchFindsSoundcloudAndSecondarySources() {
        val sc = Song(id = "soundcloud-1", title = "T", sourceURL = "https://soundcloud.com/Some-Artist/some-track")
        val yt = Song(id = "x", title = "T", sources = listOf(SongSource(source = "youtube", id = "QCuUAClm-hQ")))
        val songs = listOf(sc, yt)
        assertEquals("soundcloud-1", libraryMatch("look: https://m.soundcloud.com/some-artist/some-track?si=1", songs)?.id)
        assertEquals("x", libraryMatch("https://www.youtube.com/watch?v=QCuUAClm-hQ&t=5", songs)?.id)
        assertNull(libraryMatch("https://soundcloud.com/other/track", songs))
        assertNull(libraryMatch("", songs))
    }
}

/** Mirrors `ios/Tests/PlaybackSeekTests.swift` and `ios/Tests/ProgressGateTests.swift`, plus the text formats. */
class FormattingTest {
    @Test
    fun tapSkipsFiveSecondsTowardTappedSide() {
        assertEquals(45.0, PlaybackSeek.tapTarget(current = 50.0, duration = 200.0, tapped = 20.0))
        assertEquals(55.0, PlaybackSeek.tapTarget(current = 50.0, duration = 200.0, tapped = 80.0))
        assertNull(PlaybackSeek.tapTarget(current = 50.0, duration = 200.0, tapped = 50.0))
    }

    @Test
    fun tapSkipClampsAtSongBounds() {
        assertEquals(0.0, PlaybackSeek.tapTarget(current = 3.0, duration = 200.0, tapped = 0.0))
        assertEquals(200.0, PlaybackSeek.tapTarget(current = 198.0, duration = 200.0, tapped = 200.0))
    }

    @Test
    fun invalidDurationOrPositionDoesNotSeek() {
        assertNull(PlaybackSeek.tapTarget(current = 2.0, duration = 0.0, tapped = 0.0))
        assertNull(PlaybackSeek.tapTarget(current = 2.0, duration = 30.0, tapped = Double.POSITIVE_INFINITY))
    }

    @Test
    fun firstValueAlwaysPasses() {
        assertTrue(ProgressGate(0.25).admit(0.0, now = 10.0))
    }

    @Test
    fun samePercentIsDropped() {
        val gate = ProgressGate(0.25)
        assertTrue(gate.admit(0.101, now = 10.0))
        assertFalse(gate.admit(0.109, now = 11.0))
    }

    @Test
    fun newPercentWithinTheIntervalIsDropped() {
        val gate = ProgressGate(0.25)
        assertTrue(gate.admit(0.10, now = 10.0))
        assertFalse(gate.admit(0.11, now = 10.1))
        assertTrue(gate.admit(0.12, now = 10.26))
    }

    @Test
    fun completionAlwaysPasses() {
        val gate = ProgressGate(0.25)
        assertTrue(gate.admit(0.99, now = 10.0))
        assertTrue(gate.admit(1.0, now = 10.01))
        assertFalse(gate.admit(1.0, now = 10.02))
    }

    @Test
    fun outOfRangeValuesAreClamped() {
        val gate = ProgressGate(0.0)
        assertTrue(gate.admit(-0.5, now = 1.0))
        assertFalse(gate.admit(0.0, now = 2.0))
        assertTrue(gate.admit(1.5, now = 3.0))
        assertFalse(gate.admit(1.0, now = 4.0))
    }

    @Test
    fun aFastDownloadReachesTheScreenAtTheIntervalNotPerChunk() {
        val gate = ProgressGate(0.25)
        val passed = (0..1000).count { gate.admit(it / 1000.0, now = 100 + it * 0.002) }
        assertTrue(passed <= 10)
        assertTrue(passed >= 8)
    }

    @Test
    fun timesAndSizesReadAsOnIos() {
        assertEquals("0:00", formatTime(-3.0))
        assertEquals("3:07", formatTime(187.9))
        assertEquals("75:00", formatTime(4500.0))
        assertEquals("0:00", formatTime(Double.NaN))
        assertEquals("3:07", formatClock(187.9))
        assertEquals("1:15:00", formatClock(4500.0))
        assertEquals("24:00:00", formatClock(1e9))
        assertEquals("52 s", formatTotalLength(52.2))
        assertEquals("43 min", formatTotalLength(43 * 60.0 + 10))
        assertEquals("1 h 04 min", formatTotalLength(64 * 60.0))
        assertEquals("0 KB", formatBytes(0))
        assertEquals("512 bytes", formatBytes(512))
        assertEquals("640 KB", formatBytes(640_000))
        assertEquals("12.3 MB", formatBytes(12_300_000))
        assertEquals("5 MB", formatBytes(5_000_000))
        assertEquals("1.25 GB", formatBytes(1_250_000_000))
    }
}
