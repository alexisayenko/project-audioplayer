package com.alexisayenko.audioplayer.android.playback

import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Mirrors `ios/Tests/PlayRecorderTests.swift`: the shared `play_recorder_cases.json` (read from `server/tests/fixtures`
 * on the test classpath, never copied, AND-020) and the relaunch cases.
 */
class PlayRecorderTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Serializable
    private data class Step(val op: String, val id: String? = null, val to: Double? = null, val step: Double? = null)

    @Serializable
    private data class Expected(val song_id: String, val listened_s: Double)

    @Serializable
    private data class RecorderCase(val name: String, val ops: List<Step>, val plays: List<Expected>)

    private val scope = CoroutineScope(Dispatchers.Unconfined)

    @After
    fun stopRetries() = scope.cancel()

    /** A play log that never reaches a server: the sink reports "no network". */
    private fun log(directory: File) = PlayLog(directory, { _, _ -> null }, scope)

    private fun cases(): List<RecorderCase> {
        val url = javaClass.classLoader!!.getResource("play_recorder_cases.json") ?: error("play_recorder_cases.json is not on the test classpath")
        return Json.decodeFromString(ListSerializer(RecorderCase.serializer()), url.readText())
    }

    private fun run(ops: List<Step>): List<Expected> {
        val directory = folder.newFolder()
        val log = log(directory)
        val recorder = PlayRecorder(log, directory)
        var playing: String? = null
        var position = 0.0
        fun tick(to: Double) {
            position = to
            recorder.tick(playing, to)
        }
        for (op in ops) {
            when (op.op) {
                "start" -> {
                    playing = op.id
                    tick(0.0)
                }
                "resume" -> tick(position)
                "advance" -> {
                    val step = op.step ?: 0.5
                    var t = position + step
                    while (t <= (op.to ?: 0.0) + 1e-9) {
                        tick(t)
                        t += step
                    }
                }
                "tick" -> tick(op.to ?: 0.0)
                "seek" -> {
                    recorder.seeked()
                    tick(op.to ?: 0.0)
                }
                "pause" -> recorder.paused(position)
                "song" -> {
                    recorder.songChanged()
                    playing = op.id
                    tick(0.0)
                }
                "end" -> recorder.ended(position)
                else -> fail("unknown op ${op.op}")
            }
        }
        return log.pendingPlays.map { Expected(it.songID, it.listened) }
    }

    @Test
    fun theSharedPlayRecorderCasesMatchTheWebRecorder() {
        val all = cases()
        assertTrue(all.size >= 10)
        for (c in all) assertEquals(c.name, c.plays, run(c.ops))
    }

    @Test
    fun aPlayContinuesTheSameSongAfterARelaunchWithinTenMinutes() {
        val directory = folder.newFolder()
        var clock = 1_000_000_000L
        val log = log(directory)
        val first = PlayRecorder(log, directory) { clock }
        for (i in 0..16) first.tick("a", i * 0.5)
        first.paused(8.0)
        clock += 60_000
        val second = PlayRecorder(log, directory) { clock }
        for (i in 0..16) second.tick("a", i * 0.5)
        second.ended(8.0)
        val plays = log.pendingPlays
        assertEquals(listOf("a", "a"), plays.map { it.songID })
        assertEquals(listOf(null, true), plays.map { it.cont })
    }

    @Test
    fun theSameSongLaterThanTenMinutesIsNotAContinuation() {
        val directory = folder.newFolder()
        var clock = 1_000_000_000L
        val log = log(directory)
        val first = PlayRecorder(log, directory) { clock }
        for (i in 0..16) first.tick("a", i * 0.5)
        first.terminating()
        clock += PlayRecorder.CONT_WINDOW_MS + 1
        val second = PlayRecorder(log, directory) { clock }
        for (i in 0..16) second.tick("a", i * 0.5)
        second.ended(8.0)
        assertEquals(listOf(null, null), log.pendingPlays.map { it.cont })
    }

    @Test
    fun anOpenPlayLeftOnDiskIsQueuedOnTheNextStart() {
        val directory = folder.newFolder()
        val log = log(directory)
        val first = PlayRecorder(log, directory)
        for (i in 0..18) first.tick("a", i * 0.5)
        first.paused(9.0)
        assertTrue(log.pendingPlays.isEmpty())
        PlayRecorder(log, directory)
        assertEquals(listOf("a"), log.pendingPlays.map { it.songID })
    }

    @Test
    fun theOpenPlayCountsBeforeItIsFlushed() {
        val directory = folder.newFolder()
        val recorder = PlayRecorder(log(directory), directory)
        assertNull(recorder.openRecord)
        for (i in 0..6) recorder.tick("a", i * 0.5)
        assertEquals("a", recorder.openRecord?.songID)
        assertEquals(3.0, recorder.openRecord?.listened)
    }

    @Test
    fun terminatingEndsTheOpenPlayAndRemembersItForAContinuation() {
        val directory = folder.newFolder()
        var clock = 1_000_000_000L
        val log = log(directory)
        val first = PlayRecorder(log, directory) { clock }
        for (i in 0..16) first.tick("a", i * 0.5)
        first.terminating()
        assertEquals(listOf("a"), log.pendingPlays.map { it.songID })
        clock += 30_000
        val second = PlayRecorder(log, directory) { clock }
        assertEquals(1, log.pendingPlays.size) // nothing is queued twice
        for (i in 0..16) second.tick("a", i * 0.5)
        second.ended(8.0)
        assertEquals(listOf(null, true), log.pendingPlays.map { it.cont })
    }

    @Test
    fun theTimestampIsUtcWithMilliseconds() {
        assertEquals("1970-01-01T00:00:01.500Z", PlayRecorder.iso(1_500))
        assertEquals("2026-11-11T10:30:00.007Z", PlayRecorder.iso(1_794_393_000_007))
    }
}
