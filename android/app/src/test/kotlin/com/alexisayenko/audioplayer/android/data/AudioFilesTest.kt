package com.alexisayenko.audioplayer.android.data

import com.alexisayenko.audioplayer.android.data.store.AudioFiles
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Naming as `ios/Sources/AudioFiles.swift`; the adopt cases mirror `AudioFilesAdoptTests` in `ios/Tests/LibraryIndexTests.swift`. */
class AudioFilesTest {
    private lateinit var dir: File
    private lateinit var audio: AudioFiles

    @Before
    fun setUp() {
        dir = File(tempDir("audio-files"), "audio")
        audio = AudioFiles(dir)
    }

    @After
    fun tearDown() {
        dir.parentFile!!.deleteRecursively()
    }

    private fun touch(name: String) = File(dir, name).writeText("x")

    @Test
    fun baseNameIsArtistDashTitle() {
        assertEquals("Haddaway - What Is Love", AudioFiles.baseName("What Is Love", "Haddaway"))
        assertEquals("What Is Love", AudioFiles.baseName("What Is Love", ""))
        assertEquals("What Is Love", AudioFiles.baseName("What Is Love", "  "))
        assertNull(AudioFiles.baseName("", "Haddaway"))
        assertNull(AudioFiles.baseName(" ./:*? ", "Haddaway"))
    }

    @Test
    fun cleaningStripsWhatAFileSystemDislikes() {
        assertEquals("ACDC Back In Black", AudioFiles.clean("AC/DC: Back\\ In? *Black*"))
        assertEquals("a b c", AudioFiles.clean("  a \t b\n\nc  "))
        assertEquals("Title", AudioFiles.clean("...Title. . "))
        assertEquals("quote", AudioFiles.clean("\"quote\"<>|"))
        assertEquals("ab", AudioFiles.clean("a\u0000\u0007b"))
        assertEquals("ab", AudioFiles.clean("a​b"))
        assertEquals("a b", AudioFiles.clean("a b"))
        assertEquals("Björk - Jóga 🎵", AudioFiles.clean("Björk - Jóga 🎵"))
    }

    @Test
    fun longNamesAreCutAtOneHundredAndTwentyCharacters() {
        val base = AudioFiles.baseName("T".repeat(200), "Artist")!!
        assertEquals(120, base.length)
        assertTrue(base.startsWith("Artist - TTT"))
        val emoji = AudioFiles.baseName("🎵".repeat(200), "")!!
        assertEquals(120, emoji.codePointCount(0, emoji.length))
    }

    @Test
    fun aSongWithoutAnEntryUsesTheLegacyName() {
        assertEquals("abc.m4a", audio.file("abc").name)
        assertEquals(dir, audio.file("abc").parentFile)
    }

    @Test
    fun loadIgnoresEntriesThatAreNotPlainM4aNames() {
        audio.load(mapOf("a" to "Good - Name.m4a", "b" to "", "c" to "../evil.m4a", "d" to "wrong.mp3"))
        assertEquals("Good - Name.m4a", audio.file("a").name)
        assertEquals("b.m4a", audio.file("b").name)
        assertEquals("c.m4a", audio.file("c").name)
        assertEquals("d.m4a", audio.file("d").name)
        assertEquals(mapOf("a" to "Good - Name.m4a"), audio.snapshot(setOf("a", "b")))
        audio.forget("a")
        assertEquals("a.m4a", audio.file("a").name)
    }

    @Test
    fun reserveGivesAReadableNameAndRemembersIt() {
        val song = Song(id = "aaaaaaaaaaa", title = "One", artist = "Artist")
        assertEquals("Artist - One.m4a", audio.reserve(song).name)
        assertEquals("Artist - One.m4a", audio.file(song.id).name)
        assertEquals("Artist - One.m4a", audio.reserve(song.copy(title = "Renamed")).name)
    }

    @Test
    fun reserveAvoidsNamesOtherSongsOwnOrFilesOccupy() {
        audio.reserve(Song(id = "a", title = "Same", artist = "Artist"))
        assertEquals("Artist - Same (2).m4a", audio.reserve(Song(id = "b", title = "same", artist = "ARTIST")).name.replace("ARTIST - same", "Artist - Same"))
        touch("Artist - Other.m4a")
        assertEquals("Artist - Other (2).m4a", audio.reserve(Song(id = "c", title = "Other", artist = "Artist")).name)
    }

    @Test
    fun reserveKeepsTheLegacyFileAndTheIdNameWithoutATitle() {
        touch("legacy00001.m4a")
        assertEquals("legacy00001.m4a", audio.reserve(Song(id = "legacy00001", title = "Has Title", artist = "A")).name)
        assertEquals("untitled001.m4a", audio.reserve(Song(id = "untitled001", title = "", artist = "A")).name)
    }

    @Test
    fun syncRenamesTheFileToMatchTheSong() {
        touch("aaaaaaaaaaa.m4a")
        val song = Song(id = "aaaaaaaaaaa", title = "One", artist = "Artist")
        assertTrue(audio.sync(song))
        assertTrue(File(dir, "Artist - One.m4a").exists())
        assertFalse(File(dir, "aaaaaaaaaaa.m4a").exists())
        assertFalse("the name already fits", audio.sync(song))
        assertTrue(audio.sync(song.copy(title = "Two")))
        assertEquals("Artist - Two.m4a", audio.file(song.id).name)
        assertTrue(File(dir, "Artist - Two.m4a").exists())
    }

    @Test
    fun syncLeavesSongsWithoutAFileOrATitleAndCollisionSuffixesAlone() {
        assertFalse(audio.sync(Song(id = "nofile", title = "T", artist = "A")))
        touch("notitle.m4a")
        assertFalse(audio.sync(Song(id = "notitle", title = "", artist = "A")))
        touch("Artist - Same (2).m4a")
        audio.load(mapOf("b" to "Artist - Same (2).m4a"))
        assertFalse(audio.sync(Song(id = "b", title = "Same", artist = "Artist")))
        assertFalse(audio.syncAll(listOf(Song(id = "b", title = "Same", artist = "Artist"))))
    }

    @Test
    fun filesNamedForTheirSongAreTiedBackToTheirIds() {
        touch("Artist - One.m4a")
        touch("Artist - Same.m4a")
        touch("Artist - Same (2).m4a")
        val songs = listOf(
            Song(id = "aaaaaaaaaaa", title = "One", artist = "Artist"),
            Song(id = "bbbbbbbbbbb", title = "Same", artist = "Artist"),
            Song(id = "ccccccccccc", title = "Same", artist = "Artist"),
            Song(id = "ddddddddddd", title = "Missing", artist = "Artist"),
        )
        assertTrue(audio.adopt(songs))
        assertEquals("Artist - One.m4a", audio.file("aaaaaaaaaaa").name)
        assertEquals("Artist - Same.m4a", audio.file("bbbbbbbbbbb").name)
        assertEquals("Artist - Same (2).m4a", audio.file("ccccccccccc").name)
        assertEquals("ddddddddddd.m4a", audio.file("ddddddddddd").name)
    }

    @Test
    fun aSongWithALegacyFileOrAnEntryIsLeftAlone() {
        touch("ccccccccccc.m4a")
        touch("Artist - Kept.m4a")
        touch("Artist - Other.m4a")
        audio.load(mapOf("aaaaaaaaaaa" to "Artist - Kept.m4a"))
        val songs = listOf(
            Song(id = "aaaaaaaaaaa", title = "Other", artist = "Artist"),
            Song(id = "ccccccccccc", title = "Other", artist = "Artist"),
        )
        assertFalse(audio.adopt(songs))
        assertEquals("Artist - Kept.m4a", audio.file("aaaaaaaaaaa").name)
        assertEquals("ccccccccccc.m4a", audio.file("ccccccccccc").name)
    }

    @Test
    fun aFileAnotherSongOwnsIsNotTaken() {
        touch("Artist - Same.m4a")
        audio.load(mapOf("zzzzzzzzzzz" to "Artist - Same.m4a"))
        assertFalse(audio.adopt(listOf(Song(id = "aaaaaaaaaaa", title = "Same", artist = "Artist"))))
    }
}
