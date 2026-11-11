package com.alexisayenko.audioplayer.android.logic

import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.model.SongVersion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirrors `ios/Tests/LibraryQueryTests.swift` case for case. The Swift query is a mutable object that saves its sort
 * to UserDefaults; the Kotlin one is immutable, so each `q.x = y` there is a `copy(x = y)` here and the relaunch case
 * goes through [LibraryQuery.restored].
 */
class LibraryQueryTest {
    private fun song(
        id: String,
        title: String = "Song",
        artist: String = "Artist",
        year: Int? = null,
        tags: List<String> = emptyList(),
        bpm: Double? = null,
        length: Double? = null,
    ) = Song(id = id, title = title, artist = artist, duration = length, year = year, tags = tags, bpm = bpm)

    private fun LibraryQuery.ids(songs: List<Song>, phoneIds: Set<String> = emptySet(), listening: Map<String, LibraryListeningEntry> = emptyMap()) =
        results(songs, phoneIds, listening).map { it.id }

    @Test
    fun searchFindsAccentsStructuredCreditsVersionsAndCountryNames() {
        val track = song("a", "Café", tags = listOf("country:lt")).copy(
            mainArtists = listOf("Main"),
            featuredArtists = listOf("Guest"),
            withArtists = listOf("Collaborator"),
            version = SongVersion(type = "remix", name = "Night Mix", artists = listOf("Producer")),
            albums = listOf("Collection"),
        )
        for (term in listOf("CAFE", "guest", "collaborator", "night mix", "producer", "collection", "Lithuania")) {
            assertEquals(term, listOf("a"), LibraryQuery(search = term).ids(listOf(track)))
        }
    }

    @Test
    fun selectionsUseOrWithinFacetAndAndAcrossFacets() {
        val songs = listOf(
            song("a", year = 2024, tags = listOf("genre:house", "country:lt")),
            song("b", year = 2024, tags = listOf("genre:pop", "country:lt")),
            song("c", year = 2024, tags = listOf("genre:house", "country:se")),
        )
        var q = LibraryQuery(selection = setOf("genre:house", "genre:pop", "country:lt", "era:2020"))
        assertEquals(setOf("a", "b"), q.ids(songs).toSet())
        q = q.copy(downloadedOnly = true)
        assertEquals(listOf("b"), q.ids(songs, phoneIds = setOf("b")))
    }

    @Test
    fun eraComesFromDisplayedYearAndUnknownCombinesAsAnAlternative() {
        val version = song("v", year = 1980, tags = listOf("decade:80s")).copy(version = SongVersion(type = "remix", releaseYear = 2024))
        val unknown = song("u")
        assertEquals(setOf("era:2020"), LibraryFacet.Era.keys(version))
        assertEquals(listOf("era:2020", "era:__unset__"), LibraryFacet.Era.values(listOf(version, unknown)).map { it.id })
        val q = LibraryQuery(selection = setOf("era:2020", "era:__unset__"))
        assertEquals(2, q.results(listOf(version, unknown), emptySet()).size)
    }

    @Test
    fun remasterKeepsOriginalYearAndStructuredGenresAreFilterable() {
        val track = song("a", year = 1984).copy(version = SongVersion(type = "remaster", releaseYear = 2024), genres = listOf("House"))
        assertEquals(1984, track.libraryYear)
        assertEquals(setOf("genre:house"), LibraryFacet.Genres.keys(track))
    }

    @Test
    fun missingSortValuesStayLastInBothDirectionsWithStableTies() {
        val songs = listOf(
            song("missing", "Alpha"),
            song("z", "Same", year = 2020, bpm = 120.0, length = 180.0),
            song("a", "Same", year = 2020, bpm = 120.0, length = 180.0),
            song("early", "Early", year = 1990, bpm = 90.0, length = 100.0),
        )
        for (sort in listOf(LibrarySort.Year, LibrarySort.Bpm, LibrarySort.Length)) {
            for (reversed in listOf(false, true)) {
                val result = LibraryQuery().choose(sort).copy(reversed = reversed).ids(songs)
                assertEquals("$sort, $reversed", "missing", result.last())
                assertTrue("$sort, $reversed", result.indexOf("a") < result.indexOf("z"))
            }
        }
    }

    @Test
    fun titleArtistAndDirectionDefaults() {
        val songs = listOf(song("a", "Zulu", artist = "Éclair"), song("b", "Alpha", artist = "Beta"), song("c", "Missing", artist = ""))
        var q = LibraryQuery().choose(LibrarySort.Artist)
        assertEquals(listOf("b", "a", "c"), q.ids(songs))
        q = q.copy(reversed = true)
        assertEquals(listOf("a", "b", "c"), q.ids(songs))
        q = q.choose(LibrarySort.Title)
        assertFalse(q.reversed)
        assertEquals(listOf("b", "c", "a"), q.ids(songs))
    }

    @Test
    fun listeningCountsSkippedSongsAsPreviouslyPlayedAndSortsDates() {
        val entries = fixtureJson.decodeFromString<Map<String, LibraryListeningEntry>>(
            """{"a":{"listened":{"all":0},"skipped":{"all":1},"last_listened":null},"b":{"listened":{"all":3},"last_listened":"2026-10-22"},"c":{"listened":{"all":1},"last_listened":"2026-10-20"}}""",
        )
        val songs = listOf(song("a"), song("b"), song("c"), song("d"))
        var q = LibraryQuery(neverListened = true)
        assertEquals(listOf("d"), q.ids(songs, listening = entries))
        q = q.copy(neverListened = false).choose(LibrarySort.Listened)
        assertEquals(listOf("b", "c", "a", "d"), q.ids(songs, listening = entries))
        q = q.copy(reversed = true)
        assertEquals(listOf("c", "b", "a", "d"), q.ids(songs, listening = entries))
    }

    @Test
    fun memoizedResultsRunTheFilterOnceWhileNothingChanges() {
        val q = LibraryQuery()
        val memo = LibraryResultsMemo()
        val songs = listOf(song("a", "Beta"), song("b", "Alpha"))
        val stamp = LibraryResultsMemo.DataStamp(phoneOnly = false, library = 1, listening = 1)
        val expected = q.ids(songs)
        repeat(5) { assertEquals(expected, memo.results(q, { songs }, emptySet(), emptyMap(), stamp).map { it.id }) }
        assertEquals(1, memo.computed)
    }

    @Test
    fun memoizedResultsFollowTheQueryAndTheStamp() {
        var q = LibraryQuery()
        val memo = LibraryResultsMemo()
        val songs = listOf(song("a", "Beta"), song("b", "Alpha"))
        var stamp = LibraryResultsMemo.DataStamp(phoneOnly = false, library = 1, listening = 1)
        memo.results(q, { songs }, emptySet(), emptyMap(), stamp)
        q = q.copy(search = "alpha")
        assertEquals(listOf("b"), memo.results(q, { songs }, emptySet(), emptyMap(), stamp).map { it.id })
        q = q.choose(LibrarySort.Title).copy(search = "")
        assertEquals(listOf("b", "a"), memo.results(q, { songs }, emptySet(), emptyMap(), stamp).map { it.id })
        stamp = stamp.copy(library = 2)
        val more = songs + song("c", "Aardvark")
        assertEquals(listOf("c", "b", "a"), memo.results(q, { more }, emptySet(), emptyMap(), stamp).map { it.id })
        assertEquals(4, memo.computed)
    }

    @Test
    fun memoizedResultsSkipReadingTheSongsWhenCached() {
        val q = LibraryQuery()
        val memo = LibraryResultsMemo()
        val stamp = LibraryResultsMemo.DataStamp(phoneOnly = true, library = 3, listening = 0)
        var reads = 0
        val songs = {
            reads += 1
            listOf(song("a"))
        }
        memo.results(q, songs, emptySet(), emptyMap(), stamp)
        memo.results(q, songs, emptySet(), emptyMap(), stamp)
        assertEquals(1, reads)
    }

    @Test
    fun clearKeepsSortAndRelaunchRestoresOnlySort() {
        var q = LibraryQuery().choose(LibrarySort.Length).copy(
            reversed = true, search = "hello", selection = setOf("genre:house"), neverListened = true, downloadedOnly = true,
        )
        assertTrue(q.narrowing)
        q = q.clear()
        assertFalse(q.narrowing)
        assertEquals(LibrarySort.Length, q.sort)
        assertTrue(q.reversed)
        q = q.copy(search = "temporary")
        val restored = LibraryQuery.restored(q.sort.label, q.reversed)
        assertEquals(LibrarySort.Length, restored.sort)
        assertTrue(restored.reversed)
        assertFalse(restored.narrowing)
        assertEquals(LibrarySort.Newest, LibraryQuery.restored(null, false).sort)
        assertEquals(LibrarySort.Newest, LibraryQuery.restored("No such sort", false).sort)
    }

    /** Not in the Swift suite: the chip helpers the Kotlin query adds. */
    @Test
    fun toggleAndSelectedWorkPerFacet() {
        val q = LibraryQuery().toggle("genre:house").toggle("era:1990").toggle("genre:pop").toggle("genre:house")
        assertEquals(setOf("genre:pop", "era:1990"), q.selection)
        assertEquals(setOf("genre:pop"), q.selected(LibraryFacet.Genres))
        assertEquals(emptySet<String>(), q.selected(LibraryFacet.Countries))
    }

    /** Not in the Swift suite: the facet texts the chips show. */
    @Test
    fun facetLabelsNounsAndValueOrder() {
        assertEquals("’90s", LibraryFacet.Era.label("era:1990"))
        assertEquals("’00s", LibraryFacet.Era.label("era:2000"))
        assertEquals("Unknown", LibraryFacet.Genres.label("genre:__unset__"))
        assertEquals("Lithuania", LibraryFacet.Countries.label("country:lt"))
        assertEquals("live", LibraryFacet.Tags.label("tags:live"))
        assertEquals("Decades", LibraryFacet.Era.title)
        assertEquals("country", LibraryFacet.Countries.noun(1))
        assertEquals("countries", LibraryFacet.Countries.noun(2))
        assertEquals("genres", LibraryFacet.Genres.noun(0))
        val songs = listOf(
            song("a", tags = listOf("genre:House", "live")),
            song("b", tags = listOf("genre:house", "genre:Pop")),
            song("c", tags = listOf("genre:ambient")),
            song("d"),
        )
        val genres = LibraryFacet.Genres.values(songs)
        assertEquals(listOf("genre:house", "genre:ambient", "genre:pop", "genre:__unset__"), genres.map { it.id })
        assertEquals(listOf("House", "ambient", "Pop", "Unknown"), genres.map { it.label })
        assertEquals(listOf(2, 1, 1, 1), genres.map { it.count })
        assertEquals(listOf("tags:live"), LibraryFacet.Tags.values(songs).map { it.id })
    }

    /** Not in the Swift suite: the older tag-only filter of `LibraryFilterModel.swift`. */
    @Test
    fun tagFilterUsesOrWithinACategoryAndAndAcross() {
        val track = song("a", tags = listOf("Genre:House", "decade:90s", "live", "lang:en"))
        assertTrue(tagFilterMatches(track, emptySet()))
        assertTrue(tagFilterMatches(track, setOf("genre:house", "genre:pop")))
        assertFalse(tagFilterMatches(track, setOf("genre:house", "decade:80s")))
        assertTrue(tagFilterMatches(track, setOf("live", "decade:90s")))
        assertFalse(FilterCategory.entries.any { it.owns("lang:en") })
        val counts = listOf(TagCount("decade:00s", 1), TagCount("decade:90s", 2), TagCount("genre:pop", 1))
        assertEquals(listOf("decade:90s", "decade:00s"), FilterCategory.Years.values(counts).map { it.tag })
    }
}
