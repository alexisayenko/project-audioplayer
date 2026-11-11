package com.alexisayenko.audioplayer.android.data

import com.alexisayenko.audioplayer.android.data.store.AudioFiles
import com.alexisayenko.audioplayer.android.data.store.LibraryIndex
import com.alexisayenko.audioplayer.android.fixture
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Mirrors `ios/Tests/LibraryIndexTests.swift`. */
class LibraryIndexTest {
    private lateinit var dir: File
    private lateinit var index: LibraryIndex
    private var clock = 1_800_000_000_000L

    private val on = Song(id = "aaaaaaaaaaa", title = "On Phone", artist = "Artist")
    private val off = Song(id = "bbbbbbbbbbb", title = "Not Here", artist = "Artist")
    private val names = mapOf("aaaaaaaaaaa" to "Artist - On Phone.m4a")

    @Before
    fun setUp() {
        dir = tempDir("library-index")
        index = LibraryIndex(File(dir, "library.json"), File(dir, "phone-index.json"), now = { clock })
    }

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun saved(etag: String? = "tag") = index.save(etag, listOf(on, off), names, setOf(on.id))

    private fun copies(of: File): List<String> = dir.list()!!.filter { it.startsWith(of.name + ".corrupt-") }

    @Test
    fun nothingOnDiskLoadsEmptyWithoutACopy() {
        val loaded = index.load()
        assertTrue(loaded.songs.isEmpty())
        assertTrue(loaded.files.isEmpty())
        assertFalse(loaded.recovered)
        assertFalse(index.goodFile.exists())
    }

    @Test
    fun savedIndexLoadsBackWithItsEtagAndFileMap() {
        saved()
        val loaded = index.load()
        assertEquals(listOf(on.id, off.id), loaded.songs.map { it.id })
        assertEquals(names, loaded.files)
        assertEquals("tag", loaded.etag)
        assertFalse(loaded.recovered)
        assertEquals(setOf(on.id), loaded.phoneIds)
        assertFalse(File(dir, "library.json.tmp").exists())
    }

    @Test
    fun theFilesKeepTheIosShape() {
        index.save("tag", listOf(on.copy(addedAt = 1_700_000_000_000L, onServer = true), off), names, setOf(on.id))
        val catalog = Json.parseToJsonElement(index.catalogFile.readText()).jsonObject
        assertEquals(setOf("etag", "schema", "songs", "files"), catalog.keys)
        assertEquals("2", catalog["schema"].toString())
        assertEquals(setOf("id", "title", "artist", "addedAt", "onServer"), catalog["songs"]!!.jsonArray[0].jsonObject.keys)
        val phone = Json.parseToJsonElement(index.phoneFile.readText()).jsonObject
        assertEquals(setOf("version", "files", "songs"), phone.keys)
        assertEquals("1", phone["version"].toString())
    }

    @Test
    fun phoneIndexHoldsOnlyTheSongsOnThePhone() {
        saved()
        val text = index.phoneFile.readText()
        assertTrue(text.contains(on.id))
        assertFalse(text.contains(off.id))
    }

    @Test
    fun aCorruptCatalogFallsBackToTheLastGoodCopy() {
        saved()
        index.load()
        assertTrue(index.goodFile.exists())
        index.catalogFile.writeText("{\"songs\": [")
        val loaded = index.load()
        assertEquals(listOf(on.id, off.id), loaded.songs.map { it.id })
        assertEquals(names, loaded.files)
        assertTrue(loaded.recovered)
        assertNull(loaded.etag)
        assertEquals(1, copies(index.catalogFile).size)
        assertEquals("{\"songs\": [", File(dir, copies(index.catalogFile).single()).readText())
    }

    @Test
    fun aCorruptCatalogWithoutAGoodCopyStillKeepsTheSongsOnThePhone() {
        saved()
        index.catalogFile.writeText("not json")
        val loaded = index.load()
        assertEquals(listOf(on.id), loaded.songs.map { it.id })
        assertEquals(names, loaded.files)
        assertTrue(loaded.recovered)
        assertEquals(1, copies(index.catalogFile).size)
    }

    @Test
    fun aMissingCatalogIsRebuiltFromThePhoneIndex() {
        saved()
        index.catalogFile.delete()
        val loaded = index.load()
        assertEquals(listOf(on.id), loaded.songs.map { it.id })
        assertEquals(names, loaded.files)
        assertNull(loaded.etag)
    }

    @Test
    fun aCorruptPhoneIndexKeepsTheCatalogAndItsFileMap() {
        saved()
        index.phoneFile.writeText("{")
        val loaded = index.load()
        assertEquals(listOf(on.id, off.id), loaded.songs.map { it.id })
        assertEquals(names, loaded.files)
        assertTrue(loaded.recovered)
        assertEquals(1, copies(index.phoneFile).size)
    }

    @Test
    fun bothFilesCorruptLoadsEmptyAndKeepsBothCopies() {
        saved()
        index.catalogFile.writeText("x")
        index.phoneFile.writeText("y")
        val loaded = index.load()
        assertTrue(loaded.songs.isEmpty())
        assertTrue(loaded.recovered)
        assertEquals(1, copies(index.catalogFile).size)
        assertEquals(1, copies(index.phoneFile).size)
    }

    @Test
    fun oneUnreadableSongRecordIsDroppedNotTheWholeCatalog() {
        index.catalogFile.writeText(
            """{"etag": "tag", "schema": 2, "songs": [{"id": "aaaaaaaaaaa", "title": "On Phone", "artist": "Artist"}, {"id": 5}, {"title": "no id"}],
             "files": {"aaaaaaaaaaa": "Artist - On Phone.m4a"}}""",
        )
        val loaded = index.load()
        assertEquals(listOf("aaaaaaaaaaa"), loaded.songs.map { it.id })
        assertEquals(names, loaded.files)
        assertTrue(loaded.recovered)
        assertNull("the next sync must refetch the catalog", loaded.etag)
    }

    @Test
    fun anOldPlainSongArrayStillLoads() {
        index.catalogFile.writeText("[{\"id\": \"aaaaaaaaaaa\", \"title\": \"On Phone\", \"artist\": \"Artist\"}]")
        val loaded = index.load()
        assertEquals(listOf("aaaaaaaaaaa"), loaded.songs.map { it.id })
        assertNull(loaded.etag)
        assertFalse(loaded.recovered)
    }

    @Test
    fun anOlderSchemaDropsTheEtagOnly() {
        index.catalogFile.writeText("{\"etag\": \"old\", \"schema\": 1, \"songs\": [{\"id\": \"aaaaaaaaaaa\", \"title\": \"T\", \"artist\": \"A\"}]}")
        val loaded = index.load()
        assertNull(loaded.etag)
        assertEquals(1, loaded.songs.size)
        assertFalse(loaded.recovered)
    }

    @Test
    fun anEmptyCatalogDoesNotReplaceTheLastGoodCopy() {
        saved()
        index.load()
        val before = index.goodFile.readBytes()
        index.save(null, emptyList(), emptyMap(), emptySet())
        index.load()
        assertArrayEquals(before, index.goodFile.readBytes())
    }

    @Test
    fun theFileMapSurvivesIntoPlaybackPathsAfterARecovery() {
        saved()
        index.catalogFile.writeText("{")
        val audio = AudioFiles(File(dir, "audio"))
        audio.load(index.load().files)
        assertEquals("Artist - On Phone.m4a", audio.file(on.id).name)
    }

    @Test
    fun onlyTheNewestThreeCorruptCopiesAreKept() {
        repeat(5) {
            index.catalogFile.writeText("broken $it")
            index.load()
            clock += 60_000
        }
        val kept = copies(index.catalogFile).sorted()
        assertEquals(3, kept.size)
        assertEquals("broken 4", File(dir, kept.last()).readText())
        assertTrue(kept.first().matches(Regex("""library\.json\.corrupt-\d{8}T\d{6}""")))
    }

    @Test
    fun addedAtIsReadAsEpochMillisOrAsASwiftDate() {
        index.catalogFile.writeText(
            """{"etag":"t","schema":2,"songs":[
                {"id":"a","title":"A","artist":"","addedAt":1767261600000},
                {"id":"b","title":"B","artist":"","addedAt":788954400.5},
                {"id":"c","title":"C","artist":"","addedAt":"soon"},
                {"id":"d","title":"D","artist":"","addedAt":null}]}""",
        )
        val loaded = index.load()
        assertEquals(listOf("a", "b", "c", "d"), loaded.songs.map { it.id })
        assertEquals(1767261600000L, loaded.songs[0].addedAt)
        assertEquals(1767261600500L, loaded.songs[1].addedAt)
        assertNull(loaded.songs[2].addedAt)
        assertNull(loaded.songs[3].addedAt)
        assertFalse(loaded.recovered)
        assertEquals("t", loaded.etag)
    }

    @Test
    fun unknownFieldsFromANewerAppOrServerAreIgnored() {
        index.catalogFile.writeText("""{"etag":"t","schema":2,"future":{"x":1},"songs":[{"id":"a","title":"A","artist":"B","mood":"calm","version":{"type":"live","venue":"x"}}]}""")
        val loaded = index.load()
        assertEquals("live", loaded.songs.single().version?.type)
        assertFalse(loaded.recovered)
    }

    @Test
    fun theServersLegacyLibrarySampleLoadsAsACatalogCache() {
        index.catalogFile.writeText(fixture("legacy_library_sample.json"))
        val expected = Json.parseToJsonElement(fixture("legacy_library_sample.json")).jsonObject["songs"]!!.jsonArray.size
        val loaded = index.load()
        assertEquals("only the record whose year is a boolean is dropped", expected - 1, loaded.songs.size)
        assertFalse(loaded.songs.any { it.id == "aaaaaaaaac5" })
        assertEquals("", loaded.songs.first { it.id == "aaaaaaaaab1" }.artist)
        assertTrue(loaded.recovered)
        assertNull("the catalog is fetched again", loaded.etag)
        val haddaway = loaded.songs.first { it.id == "aaaaaaaaaa2" }
        assertEquals("What Is Love", haddaway.title)
        assertEquals(1993, haddaway.year)
        assertEquals(listOf("genre:eurodance", "decade:90s"), haddaway.tags)
        index.save("tag", loaded.songs, emptyMap(), emptySet())
        assertEquals(loaded.songs, index.load().songs)
    }
}
