package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The queue engine the service runs (the rules of the iOS `PlayerService`), over an in-memory output: what is loaded, what
 * is skipped, what is saved and what is recorded (AND-063 to AND-066).
 */
class PlaybackEngineTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val scope = CoroutineScope(Dispatchers.Unconfined)

    @After
    fun stopRetries() = scope.cancel()

    private class Output : AudioOutput {
        override var positionMs = 0L
        override var durationMs = 0L
        var loaded: String? = null
        var wantsPlay = false
        var ended = false
        val loads = mutableListOf<String>()
        override val isPlaying: Boolean get() = wantsPlay && !ended && loaded != null

        override fun load(song: Song, file: File, positionMs: Long, play: Boolean) {
            loaded = song.id
            loads += song.id
            this.positionMs = positionMs
            durationMs = ((song.duration ?: 0.0) * 1000).toLong()
            wantsPlay = play
            ended = false
        }

        override fun play() {
            if (ended) positionMs = 0
            ended = false
            wantsPlay = true
        }

        override fun pause() {
            wantsPlay = false
        }

        override fun seekTo(positionMs: Long) {
            this.positionMs = positionMs
            ended = false
        }

        override fun clear() {
            loaded = null
            positionMs = 0
            durationMs = 0
            wantsPlay = false
        }
    }

    private val a = Song("a", "A", duration = 200.0)
    private val b = Song("b", "B", duration = 200.0)
    private val c = Song("c", "C", duration = 200.0)
    private val d = Song("d", "D", duration = 200.0)
    private val songs = listOf(a, b, c, d)

    private val output = Output()
    private val missing = mutableSetOf<String>()
    private val events = mutableListOf<PlaybackEvent>()
    private val states = mutableListOf<PlayerState>()
    private var counts: Map<String, Int>? = null
    private var now = 1_800_000_000_000L

    private fun engine(directory: File? = null, random: Random = Random(1)): PlaybackEngine {
        val log = directory?.let { PlayLog(File(it, "plays"), { _, _ -> null }, scope, now = { now }) }
        return PlaybackEngine(
            output = output,
            fileFor = { id -> if (id in missing) null else File(id) },
            listenCounts = { counts },
            recorder = log?.let { PlayRecorder(it, File(directory, "plays")) { now } },
            playLog = log,
            persistence = directory?.let { PlaybackPersistence(File(it, "playback")) { now } },
            random = random,
            now = { now },
            onEvent = { events += it },
            onState = { states += it },
        )
    }

    /** Lets the loaded song sound for [seconds]: one tick when sound starts, then two a second, as the service does. */
    private fun PlaybackEngine.listen(seconds: Double) {
        tick()
        var left = seconds
        while (left > 1e-9) {
            output.positionMs += 500
            now += 500
            tick()
            left -= 0.5
        }
    }

    private fun PlaybackEngine.finishSong() {
        output.positionMs = output.durationMs
        output.ended = true
        onEnded()
    }

    private fun ids(engine: PlaybackEngine) = engine.queue.map { it.id }

    @Test
    fun playLoadsTheStartSongAndPublishesTheState() {
        val engine = engine()
        engine.play(songs, 2)
        assertEquals("c", output.loaded)
        assertTrue(output.wantsPlay)
        val state = states.last()
        assertEquals(songs, state.queue)
        assertEquals(2, state.index)
        assertTrue(state.isPlaying)
        assertEquals(200_000L, state.durationMs)
        assertNull(state.failedSongId)
    }

    @Test
    fun nextAndPreviousWalkTheQueueAndStopAtTheEnd() {
        val engine = engine()
        engine.play(songs, 0)
        engine.next()
        assertEquals("b", output.loaded)
        engine.previous()
        assertEquals("a", output.loaded)
        engine.jumpTo(3)
        engine.next() // the end of the queue without repeat: pause, stay
        assertEquals("d", output.loaded)
        assertFalse(engine.isPlaying)
        assertFalse(engine.hasNext)
    }

    @Test
    fun previousPastThreeSecondsRewindsInsteadOfSteppingBack() {
        val engine = engine()
        engine.play(songs, 1)
        output.positionMs = 3_500
        engine.previous()
        assertEquals("b", output.loaded)
        assertEquals(0L, output.positionMs)
        engine.previous()
        assertEquals("a", output.loaded)
    }

    @Test
    fun aSongThatEndsAdvancesAndTheLastOneStops() {
        val engine = engine()
        engine.play(listOf(a, b), 0)
        engine.finishSong()
        assertEquals("b", output.loaded)
        assertTrue(engine.isPlaying)
        engine.finishSong()
        assertFalse(engine.isPlaying)
        assertEquals(1, engine.index)
    }

    @Test
    fun repeatOneRestartsTheSongThatEndedButNextStillMovesOn() {
        val engine = engine()
        engine.setRepeat(RepeatMode.One)
        engine.play(songs, 1)
        engine.finishSong()
        assertEquals(listOf("b"), output.loads)
        assertEquals(0L, output.positionMs)
        assertTrue(output.isPlaying)
        engine.next()
        assertEquals("c", output.loaded)
    }

    @Test
    fun repeatAllWrapsToTheFirstSong() {
        val engine = engine()
        engine.setRepeat(RepeatMode.All)
        engine.play(songs, 3)
        engine.finishSong()
        assertEquals("a", output.loaded)
        assertTrue(engine.isPlaying)
    }

    @Test
    fun aSongWithoutAFileIsSkippedAndReportedNeverLoaded() {
        missing += listOf("b", "c")
        val engine = engine()
        engine.play(songs, 0)
        engine.next()
        assertEquals("d", output.loaded)
        assertEquals(listOf("a", "d"), output.loads)
        assertEquals(listOf(PlaybackEvent.SkippedMissing(listOf(b, c))), events)
        assertEquals(3, engine.index)
        assertNull(engine.failedSongId)
    }

    @Test
    fun previousSkipsBackwardsOverMissingFiles() {
        missing += "b"
        val engine = engine()
        engine.play(songs, 2)
        engine.previous()
        assertEquals("a", output.loaded)
        assertEquals(listOf(PlaybackEvent.SkippedMissing(listOf(b))), events)
    }

    @Test
    fun withNothingPlayableAheadAPressChangesNothingAndAnEndedSongStops() {
        missing += listOf("c", "d")
        val engine = engine()
        engine.play(songs, 1)
        engine.next()
        assertEquals("b", output.loaded)
        assertEquals(1, engine.index)
        assertTrue(engine.isPlaying)
        assertEquals("c", engine.failedSongId)
        engine.finishSong()
        assertFalse(engine.isPlaying)
        assertEquals(listOf("b"), output.loads)
    }

    @Test
    fun startingAtAMissingSongGoesOnToTheNextPlayable() {
        missing += "a"
        val engine = engine()
        engine.play(songs, 0)
        assertEquals("b", output.loaded)
        assertEquals(1, engine.index)
    }

    @Test
    fun aQueueWithNoFileAtAllPlaysNothing() {
        missing += songs.map { it.id }
        val engine = engine()
        engine.play(songs, 1)
        assertNull(output.loaded)
        assertFalse(engine.isPlaying)
        assertEquals(1, engine.index)
        assertEquals("b", engine.failedSongId)
        // The file arrives (downloaded meanwhile): Play loads it.
        missing.clear()
        engine.resume()
        assertEquals("b", output.loaded)
        assertTrue(engine.isPlaying)
        assertNull(engine.failedSongId)
    }

    @Test
    fun underShuffleAndRepeatAllMissingFilesNeverStallTheRound() {
        missing += listOf("b", "d")
        val engine = engine(random = Random(4))
        engine.setShuffle(true)
        engine.setRepeat(RepeatMode.All)
        engine.play(songs, 0)
        repeat(12) { engine.finishSong() }
        assertTrue(engine.isPlaying)
        assertEquals(setOf("a", "c"), output.loads.toSet())
    }

    @Test
    fun shuffleRoundPlaysEverySongOnceLeastPlayedFirstThenStops() {
        counts = mapOf("a" to 0, "b" to 5, "c" to 0, "d" to 2)
        val engine = engine(random = Random(11))
        engine.setShuffle(true)
        engine.play(songs, 0)
        repeat(3) { engine.next() }
        assertEquals(listOf("a", "c", "d", "b"), output.loads)
        assertFalse(engine.hasNext)
        engine.next()
        assertFalse(engine.isPlaying)
        assertEquals(4, output.loads.size)
    }

    @Test
    fun previousUnderShuffleFollowsWhatWasPlayed() {
        counts = mapOf("a" to 0, "b" to 5, "c" to 0, "d" to 2)
        val engine = engine(random = Random(11))
        engine.setShuffle(true)
        engine.play(songs, 0)
        engine.next()
        engine.next()
        engine.previous()
        assertEquals("c", output.loaded)
        engine.previous()
        assertEquals("a", output.loaded)
    }

    @Test
    fun playAllUnderShuffleStartsInTheLeastPlayedTier() {
        counts = mapOf("a" to 3, "b" to 3, "c" to 0, "d" to 3)
        for (seed in 1..10) {
            val engine = engine(random = Random(seed))
            engine.setShuffle(true)
            engine.playAll(songs)
            assertEquals("c", output.loaded)
        }
        val plain = engine()
        plain.playAll(songs)
        assertEquals("a", output.loaded)
    }

    @Test
    fun playNowInsertsAfterTheCurrentSongAndPlaysIt() {
        val engine = engine()
        engine.play(listOf(a, b, c), 1)
        engine.playNow(d)
        assertEquals(listOf("a", "b", "d", "c"), ids(engine))
        assertEquals(2, engine.index)
        assertEquals("d", output.loaded)
        engine.playNow(a) // already queued: it moves
        assertEquals(listOf("b", "d", "a", "c"), ids(engine))
        assertEquals("a", output.loaded)
        assertEquals(2, engine.index)
    }

    @Test
    fun playNowOfASongWithoutAFileIsReportedAndChangesNothing() {
        missing += "d"
        val engine = engine()
        engine.play(listOf(a, b), 0)
        engine.playNow(d)
        assertEquals(listOf("a", "b"), ids(engine))
        assertEquals("a", output.loaded)
        assertEquals(listOf(PlaybackEvent.SkippedMissing(listOf(d))), events)
    }

    @Test
    fun playNextInsertsAfterTheCurrentSongWithoutInterrupting() {
        val engine = engine()
        engine.play(listOf(a, b, c), 0)
        engine.playNext(c)
        assertEquals(listOf("a", "c", "b"), ids(engine))
        assertEquals("a", output.loaded)
        assertEquals(0, engine.index)
        engine.playNext(a) // the current song is not queued twice
        assertEquals(listOf("a", "c", "b"), ids(engine))
    }

    @Test
    fun enqueueAppendsOnlyNewSongsAndCuesTheFirstOfAnEmptyQueue() {
        val engine = engine()
        assertEquals(2, engine.enqueue(listOf(a, b, a)))
        assertEquals(0, engine.index)
        assertEquals("a", output.loaded)
        assertFalse(engine.isPlaying)
        assertEquals(1, engine.enqueue(listOf(b, c)))
        assertEquals(listOf("a", "b", "c"), ids(engine))
    }

    @Test
    fun movingRowsKeepsTheCurrentSongCurrent() {
        val engine = engine()
        engine.play(songs, 1)
        engine.moveQueueItem(1, 3)
        assertEquals(listOf("a", "c", "d", "b"), ids(engine))
        assertEquals(3, engine.index)
        engine.moveQueueItem(0, 3)
        assertEquals(listOf("c", "d", "b", "a"), ids(engine))
        assertEquals(2, engine.index)
        assertEquals(listOf("b"), output.loads)
    }

    @Test
    fun removingAnotherRowKeepsPlayingAndRemovingTheCurrentCuesTheNeighbour() {
        val engine = engine()
        engine.play(songs, 1)
        engine.removeFromQueue(0)
        assertEquals(listOf("b", "c", "d"), ids(engine))
        assertEquals(0, engine.index)
        assertTrue(engine.isPlaying)
        engine.removeFromQueue(0)
        assertEquals(listOf("c", "d"), ids(engine))
        assertEquals(0, engine.index)
        assertEquals("c", output.loaded)
        assertFalse(engine.isPlaying)
        assertFalse(output.wantsPlay)
        engine.removeFromQueue(1)
        engine.removeFromQueue(0)
        assertTrue(engine.queue.isEmpty())
        assertNull(engine.index)
        assertNull(output.loaded)
        assertEquals(-1, states.last().index)
    }

    @Test
    fun clearQueueKeepsOnlyTheCurrentSong() {
        val engine = engine()
        engine.play(songs, 2)
        engine.clearQueue()
        assertEquals(listOf("c"), ids(engine))
        assertEquals(0, engine.index)
        assertTrue(engine.isPlaying)
    }

    @Test
    fun seekAndSkipAreClampedToTheSong() {
        val engine = engine()
        engine.play(songs, 0)
        engine.seekTo(50_000)
        engine.skipBy(-10_000)
        assertEquals(40_000L, output.positionMs)
        engine.skipBy(-100_000)
        assertEquals(0L, output.positionMs)
        engine.skipBy(900_000)
        assertEquals(200_000L, output.positionMs)
        engine.seekTo(-5)
        assertEquals(0L, output.positionMs)
    }

    @Test
    fun aPauseFromOutsideIsFollowedAndASuppressionHidesPlaying() {
        val engine = engine()
        engine.play(songs, 0)
        engine.onOutputChanged(playWhenReady = true, suppressed = true) // a call: held back, will go on by itself
        assertFalse(states.last().isPlaying)
        assertTrue(engine.isPlaying)
        engine.onOutputChanged(playWhenReady = true, suppressed = false)
        assertTrue(states.last().isPlaying)
        output.wantsPlay = false
        engine.onOutputChanged(playWhenReady = false, suppressed = false) // headphones unplugged
        assertFalse(engine.isPlaying)
        assertFalse(states.last().isPlaying)
    }

    @Test
    fun aFileThatCannotBePlayedIsMarkedAndPlayTriesItAgain() {
        val engine = engine()
        engine.play(songs, 0)
        engine.onOutputFailed()
        assertEquals("a", states.last().failedSongId)
        assertFalse(engine.isPlaying)
        assertEquals(PlaybackEvent.Failed(a), events.last())
        engine.resume()
        assertEquals(listOf("a", "a"), output.loads)
        assertNull(engine.failedSongId)
        assertTrue(engine.isPlaying)
    }

    @Test
    fun aSongThatEndsWhilePausedDoesNotStartTheNext() {
        val engine = engine()
        engine.play(songs, 0)
        engine.pause()
        engine.seekTo(200_000)
        output.ended = true
        engine.onEnded()
        assertEquals(listOf("a"), output.loads)
        assertFalse(engine.isPlaying)
    }

    // region The resume rule (AND-064)

    @Test
    fun thePositionIsSavedAtOnceOnPauseAndSeekAndAtMostEveryFiveSecondsWhilePlaying() {
        val root = folder.newFolder()
        val persistence = PlaybackPersistence(File(root, "playback"))
        val engine = engine(root)
        engine.restore(null) { null }
        engine.play(songs, 1)
        assertEquals(SavedPlayback(listOf("a", "b", "c", "d"), 1, emptyList(), 0.0), persistence.saved())
        engine.listen(4.5) // the first tick writes (0.5 s), then nothing for 5 s
        assertEquals(0.5, persistence.saved()?.position)
        engine.listen(1.5)
        assertEquals(5.5, persistence.saved()?.position)
        engine.listen(2.0)
        assertEquals(5.5, persistence.saved()?.position)
        engine.pause()
        assertEquals(8.0, persistence.saved()?.position)
        engine.seekTo(90_000)
        assertEquals(90.0, persistence.saved()?.position)
        engine.resume()
        engine.seekTo(30_000)
        assertEquals(30.0, persistence.saved()?.position)
    }

    @Test
    fun aQueueChangeIsSavedAtOnceAndANewSongStartsAtZero() {
        val root = folder.newFolder()
        val persistence = PlaybackPersistence(File(root, "playback"))
        val engine = engine(root)
        engine.restore(null) { null }
        engine.play(listOf(a, b), 0)
        engine.listen(1.0)
        engine.enqueue(listOf(c))
        assertEquals(SavedPlayback(listOf("a", "b", "c"), 0, emptyList(), 1.0), persistence.saved())
        engine.next()
        assertEquals(SavedPlayback(listOf("a", "b", "c"), 1, emptyList(), 0.0), persistence.saved())
        engine.removeFromQueue(0)
        assertEquals(listOf("b", "c"), persistence.saved()?.ids)
        assertEquals(0, persistence.saved()?.index)
    }

    private fun relaunch(root: File): PlaybackEngine {
        output.clear()
        output.loads.clear()
        states.clear()
        val engine = engine(root)
        val library = songs.associateBy { it.id }
        engine.restore(PlaybackPersistence(File(root, "playback")).saved(), library::get)
        return engine
    }

    @Test
    fun aRelaunchRestoresTheQueuePausedAtTheSavedPosition() {
        val root = folder.newFolder()
        val first = engine(root)
        first.restore(null) { null }
        first.setShuffle(true)
        first.setRepeat(RepeatMode.All)
        first.play(songs, 2)
        first.seekTo(61_500)
        first.shutdown()

        val engine = relaunch(root)
        assertEquals(listOf("a", "b", "c", "d"), ids(engine))
        assertEquals(2, engine.index)
        assertEquals("c", output.loaded)
        assertEquals(61_500L, output.positionMs)
        assertFalse(output.wantsPlay)
        assertFalse(engine.isPlaying)
        assertTrue(engine.shuffle)
        assertEquals(RepeatMode.All, engine.repeat)
        val state = states.last()
        assertEquals(61_500L, state.positionMs)
        assertFalse(state.isPlaying)
        engine.resume()
        assertTrue(output.wantsPlay)
        assertEquals(61_500L, output.positionMs)
    }

    @Test
    fun aRelaunchStartsAtZeroAtOrBelowThreeSecondsAndWithinFiveOfTheEnd() {
        for ((saved, expected) in listOf(3_000L to 0L, 3_500L to 3_500L, 195_000L to 195_000L, 195_500L to 0L, 199_000L to 0L)) {
            val root = folder.newFolder()
            val first = engine(root)
            first.restore(null) { null }
            first.play(songs, 0)
            first.seekTo(saved)
            first.shutdown()
            relaunch(root)
            assertEquals("saved at $saved ms", expected, output.positionMs)
            assertEquals("saved at $saved ms", "a", output.loaded)
        }
    }

    @Test
    fun aRelaunchDropsSongsWhoseFileIsGone() {
        val root = folder.newFolder()
        val first = engine(root)
        first.restore(null) { null }
        first.play(songs, 1)
        first.seekTo(40_000)
        first.shutdown()

        missing += "b"
        val engine = relaunch(root)
        assertEquals(listOf("a", "c", "d"), ids(engine))
        assertEquals(0, engine.index)
        assertEquals("a", output.loaded)
        assertEquals(0L, output.positionMs)

        missing += songs.map { it.id }
        val empty = relaunch(root)
        assertTrue(empty.queue.isEmpty())
        assertNull(output.loaded)
    }

    @Test
    fun commandsBeforeTheRestoreDoNotOverwriteTheSavedQueue() {
        val root = folder.newFolder()
        val persistence = PlaybackPersistence(File(root, "playback"))
        val first = engine(root)
        first.restore(null) { null }
        first.play(songs, 3)
        first.shutdown()
        val second = engine(root)
        second.setShuffle(false)
        assertEquals(3, persistence.saved()?.index)
        assertEquals(4, persistence.saved()?.ids?.size)
    }

    // endregion

    // region The play log

    @Test
    fun whatIsHeardIsRecordedAndASkipUnderFiveSecondsIsNot() {
        val root = folder.newFolder()
        val engine = engine(root)
        engine.restore(null) { null }
        engine.play(songs, 0)
        engine.listen(12.0)
        engine.next()
        engine.listen(3.0)
        engine.next()
        engine.listen(7.0)
        engine.pause()
        engine.shutdown()
        val pending = PlayLog(File(root, "plays"), { _, _ -> null }, scope).pendingPlays
        assertEquals(listOf("a" to 12.0, "c" to 7.0), pending.map { it.songID to it.listened })
    }

    @Test
    fun aSeekIsNotListeningAndTheEndOfASongClosesThePlay() {
        val root = folder.newFolder()
        val engine = engine(root)
        engine.restore(null) { null }
        engine.play(listOf(a, b), 0)
        engine.listen(6.0)
        engine.seekTo(190_000)
        engine.listen(9.5)
        engine.finishSong()
        val pending = PlayLog(File(root, "plays"), { _, _ -> null }, scope).pendingPlays
        assertEquals(listOf("a" to 16.0), pending.map { it.songID to it.listened })
        assertEquals("b", output.loaded)
    }

    @Test
    fun aSongThatLeftTheCatalogIsPlayedButNotRecorded() {
        val root = folder.newFolder()
        val local = Song("x", "X", duration = 100.0, localOnly = true)
        val engine = engine(root)
        engine.restore(null) { null }
        engine.play(listOf(local, a), 0)
        engine.listen(20.0)
        engine.next()
        engine.shutdown()
        assertTrue(PlayLog(File(root, "plays"), { _, _ -> null }, scope).pendingPlays.isEmpty())
    }

    @Test
    fun playsNotYetSentAlreadyWeighTheShuffle() {
        val root = folder.newFolder()
        counts = mapOf("a" to 0, "b" to 0, "c" to 0, "d" to 0)
        for (seed in 1..8) {
            val directory = File(root, "run$seed")
            val engine = engine(directory, Random(seed))
            engine.restore(null) { null }
            // b, c and d are heard now; the server does not know yet. Under shuffle "Play all" must start with a.
            engine.play(listOf(b, c, d), 0)
            repeat(3) {
                engine.listen(6.0)
                engine.finishSong()
            }
            engine.setShuffle(true)
            engine.playAll(songs)
            assertEquals("seed $seed", "a", output.loaded)
        }
    }

    // endregion
}
