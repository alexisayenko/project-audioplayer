package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Mirrors `ios/Tests/PlaybackResumeTests.swift` case for case, plus the restore matching and the file store (AND-064). */
class PlaybackResumeTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun positionAboveThreeSecondsResumes() {
        assertEquals(42.5, ResumePosition.start(42.5, 200.0), 0.0)
        assertEquals(3.001, ResumePosition.start(3.001, 200.0), 0.0)
    }

    @Test
    fun positionAtOrBelowThreeSecondsStartsAtZero() {
        assertEquals(0.0, ResumePosition.start(3.0, 200.0), 0.0)
        assertEquals(0.0, ResumePosition.start(0.0, 200.0), 0.0)
        assertEquals(0.0, ResumePosition.start(-4.0, 200.0), 0.0)
    }

    @Test
    fun positionWithinFiveSecondsOfTheEndStartsAtZero() {
        assertEquals(0.0, ResumePosition.start(196.0, 200.0), 0.0)
        assertEquals(0.0, ResumePosition.start(195.001, 200.0), 0.0)
        assertEquals(195.0, ResumePosition.start(195.0, 200.0), 0.0)
    }

    @Test
    fun unknownDurationStillResumes() {
        assertEquals(30.0, ResumePosition.start(30.0, null), 0.0)
        assertEquals(30.0, ResumePosition.start(30.0, 0.0), 0.0)
    }

    @Test
    fun missingOrInvalidPositionStartsAtZero() {
        assertEquals(0.0, ResumePosition.start(null, 200.0), 0.0)
        assertEquals(0.0, ResumePosition.start(Double.NaN, 200.0), 0.0)
        assertEquals(0.0, ResumePosition.start(Double.POSITIVE_INFINITY, 200.0), 0.0)
    }

    @Test
    fun checkpointWritesAtMostEveryFiveSecondsWhilePlaying() {
        val checkpoint = ResumeCheckpoint()
        val start = 1_000_000L
        assertTrue(checkpoint.due(start, playing = true))
        assertFalse(checkpoint.due(start + 500, playing = true))
        assertFalse(checkpoint.due(start + 4_900, playing = true))
        assertTrue(checkpoint.due(start + 5_000, playing = true))
        assertFalse(checkpoint.due(start + 7_000, playing = true))
    }

    @Test
    fun checkpointWritesAtOnceWhenNotPlaying() {
        val checkpoint = ResumeCheckpoint()
        val start = 1_000_000L
        assertTrue(checkpoint.due(start, playing = true))
        assertTrue(checkpoint.due(start + 1_000, playing = false))
        assertTrue(checkpoint.due(start + 1_100, playing = false))
    }

    @Test
    fun savedQueueWithoutPositionStillDecodes() {
        val saved = Json.decodeFromString(SavedPlayback.serializer(), """{"ids":["a","b"],"index":1,"tags":["house"]}""")
        assertEquals(SavedPlayback(listOf("a", "b"), 1, listOf("house"), null), saved)
    }

    @Test
    fun savedQueueRoundTripsThePosition() {
        val saved = SavedPlayback(listOf("a"), 0, emptyList(), 61.5)
        val text = Json.encodeToString(SavedPlayback.serializer(), saved)
        assertEquals(saved, Json.decodeFromString(SavedPlayback.serializer(), text))
        assertTrue(text, text.contains("\"ids\"") && text.contains("\"index\"") && text.contains("\"position\""))
    }

    @Test
    fun persistenceReadsWhatWasWritten() {
        val persistence = PlaybackPersistence(folder.root)
        assertNull(persistence.saved())
        val saved = SavedPlayback(listOf("x", "y"), 1, listOf("a"), 12.0)
        File(folder.root, "playback.json").writeText(Json.encodeToString(SavedPlayback.serializer(), saved))
        assertEquals(saved, persistence.saved())
    }

    @Test
    fun aBrokenFileReadsAsNothingSaved() {
        File(folder.root, "playback.json").writeText("{not json")
        assertNull(PlaybackPersistence(folder.root).saved())
    }

    @Test
    fun nothingIsWrittenBeforeTheRestoreWasTried() {
        val persistence = PlaybackPersistence(folder.root)
        val state = SavedPlayback(listOf("a"), 0, emptyList(), 9.0)
        persistence.queueChanged(state)
        persistence.positionChanged(state, playing = false)
        persistence.saveNow(state)
        assertNull(persistence.saved())
        persistence.begin(state)
        assertEquals(state, persistence.saved())
    }

    @Test
    fun aPlayingPositionIsWrittenAtMostEveryFiveSecondsAndAtOnceOnPause() {
        var now = 0L
        val persistence = PlaybackPersistence(folder.root) { now }
        val at = { seconds: Double -> SavedPlayback(listOf("a", "b"), 0, emptyList(), seconds) }
        persistence.begin(at(0.0))
        now = 500
        persistence.positionChanged(at(0.5), playing = true)
        assertEquals(0.5, persistence.saved()?.position)
        now = 4_000
        persistence.positionChanged(at(4.0), playing = true)
        assertEquals(0.5, persistence.saved()?.position)
        now = 5_500
        persistence.positionChanged(at(5.5), playing = true)
        assertEquals(5.5, persistence.saved()?.position)
        now = 6_000
        persistence.positionChanged(at(6.0), playing = true)
        assertEquals(5.5, persistence.saved()?.position)
        // A pause or a seek writes at once.
        persistence.saveNow(at(6.2))
        assertEquals(6.2, persistence.saved()?.position)
        persistence.positionChanged(at(90.0), playing = false)
        assertEquals(90.0, persistence.saved()?.position)
    }

    @Test
    fun aQueueChangeIsWrittenAtOnceAndANewSongStartsAtZero() {
        val persistence = PlaybackPersistence(folder.root)
        persistence.begin(SavedPlayback(listOf("a", "b"), 0, emptyList(), 40.0))
        persistence.queueChanged(SavedPlayback(listOf("a", "b", "c"), 0, emptyList(), 41.0))
        assertEquals(SavedPlayback(listOf("a", "b", "c"), 0, emptyList(), 41.0), persistence.saved())
        persistence.queueChanged(SavedPlayback(listOf("a", "b", "c"), 1, emptyList(), 41.0))
        assertEquals(SavedPlayback(listOf("a", "b", "c"), 1, emptyList(), 0.0), persistence.saved())
    }

    @Test
    fun shuffleAndRepeatAreKept() {
        val persistence = PlaybackPersistence(folder.root)
        assertEquals(SavedModes(false, "off"), persistence.savedModes())
        persistence.saveModes(shuffle = true, repeat = RepeatMode.One)
        assertEquals(SavedModes(true, "one"), PlaybackPersistence(folder.root).savedModes())
    }

    private val library = listOf(
        Song("a", "A", duration = 200.0),
        Song("b", "B", duration = 200.0),
        Song("c", "C", duration = 200.0),
    ).associateBy { it.id }

    private fun resolve(saved: SavedPlayback, missing: Set<String> = emptySet()) =
        PlaybackPersistence.resolve(saved, library::get) { it.id !in missing }

    @Test
    fun restoreKeepsTheSavedSongAtTheSavedPosition() {
        val restored = resolve(SavedPlayback(listOf("a", "b", "c"), 1, listOf("house"), 61.5))!!
        assertEquals(listOf("a", "b", "c"), restored.songs.map { it.id })
        assertEquals(1, restored.index)
        assertEquals(listOf("house"), restored.tags)
        assertEquals(61.5, restored.position, 0.0)
    }

    @Test
    fun restoreAppliesTheThreeSecondAndEndGuardBoundaries() {
        assertEquals(0.0, resolve(SavedPlayback(listOf("a"), 0, emptyList(), 3.0))!!.position, 0.0)
        assertEquals(3.5, resolve(SavedPlayback(listOf("a"), 0, emptyList(), 3.5))!!.position, 0.0)
        assertEquals(195.0, resolve(SavedPlayback(listOf("a"), 0, emptyList(), 195.0))!!.position, 0.0)
        assertEquals(0.0, resolve(SavedPlayback(listOf("a"), 0, emptyList(), 195.5))!!.position, 0.0)
        assertEquals(0.0, resolve(SavedPlayback(listOf("a"), 0, emptyList(), null))!!.position, 0.0)
    }

    @Test
    fun restoreDropsSongsWithoutAFileAndFollowsTheSavedSong() {
        val restored = resolve(SavedPlayback(listOf("a", "gone", "b", "c"), 3, emptyList(), 50.0), missing = setOf("a"))!!
        assertEquals(listOf("b", "c"), restored.songs.map { it.id })
        assertEquals(1, restored.index)
        assertEquals(50.0, restored.position, 0.0)
    }

    @Test
    fun restoreStartsTheFirstSongAtZeroWhenTheSavedSongIsGone() {
        val restored = resolve(SavedPlayback(listOf("a", "b", "c"), 1, emptyList(), 50.0), missing = setOf("b"))!!
        assertEquals(listOf("a", "c"), restored.songs.map { it.id })
        assertEquals(0, restored.index)
        assertEquals(0.0, restored.position, 0.0)
    }

    @Test
    fun restoreIsNothingWhenNoFileIsLeft() {
        assertNull(resolve(SavedPlayback(listOf("a", "b"), 0, emptyList(), 50.0), missing = setOf("a", "b")))
        assertNull(resolve(SavedPlayback(emptyList(), 0, emptyList(), null)))
    }
}
