package com.alexisayenko.audioplayer.android.playback

import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** The play log (port of the Swift `PlayQueue`, AND-065): batching, the cap, dropped answers and the retry clock, with a fake sink and virtual time. */
@OptIn(ExperimentalCoroutinesApi::class)
class PlayLogTest {
    @get:Rule
    val folder = TemporaryFolder()

    private data class Call(val atMs: Long, val key: String, val plays: List<PlayRecord>)

    /** Answers with [statuses] in turn, then with [then]; remembers every call and when it came. */
    private class FakeSink(private val scope: TestScope, vararg statuses: Int?, private val then: Int? = 200) : PlaySink {
        private val script = ArrayDeque(statuses.toList())
        val calls = mutableListOf<Call>()

        override suspend fun post(batchKey: String, plays: List<PlayRecord>): Int? {
            calls += Call(scope.currentTime, batchKey, plays)
            return if (script.isEmpty()) then else script.removeFirst()
        }
    }

    private fun play(n: Int, listened: Double = 10.0) = PlayRecord("2026-11-11T10:00:00.000Z", "song$n", listened)

    private fun TestScope.log(sink: PlaySink, directory: File = folder.root): PlayLog {
        var n = 0
        return PlayLog(directory, sink, backgroundScope, now = { currentTime }, keyFactory = { "key${++n}" })
    }

    private fun seed(count: Int) {
        val plays = (1..count).joinToString(",") { """{"timestamp":"2026-11-11T10:00:00.000Z","song_id":"song$it","listened_s":10.0}""" }
        File(folder.root, "queue.json").writeText("""{"queue":[$plays]}""")
    }

    @Test
    fun playsUnderFiveSecondsAreDroppedAndTheRestRoundedToATenth() = runTest {
        val log = log(FakeSink(this, then = null))
        log.add(play(1, 4.99))
        log.add(play(2, 5.0))
        log.add(play(3, 12.3449))
        log.add(play(4, 12.36))
        assertEquals(listOf(5.0, 12.3, 12.4), log.pendingPlays.map { it.listened })
    }

    @Test
    fun batchesHoldAtMostTwoHundredPlaysEachUnderItsOwnKey() = runTest {
        seed(450)
        val sink = FakeSink(this)
        val log = log(sink)
        assertEquals(450, log.pendingPlays.size)
        log.flush()
        runCurrent()
        assertEquals(listOf(200, 200, 50), sink.calls.map { it.plays.size })
        assertEquals(listOf("key1", "key2", "key3"), sink.calls.map { it.key })
        assertEquals("song1", sink.calls[0].plays.first().songID)
        assertEquals("song201", sink.calls[1].plays.first().songID)
        assertEquals("song450", sink.calls[2].plays.last().songID)
        assertTrue(log.pendingPlays.isEmpty())
        assertEquals(0L, currentTime)
    }

    @Test
    fun atMostAThousandPlaysWaitAndTheOldestGoFirst() = runTest {
        val log = log(FakeSink(this, then = null))
        for (n in 1..1005) log.add(play(n))
        // The first play left the queue at once as the batch in flight; of the 1004 behind it the oldest four are dropped.
        val pending = log.pendingPlays.map { it.songID }
        assertEquals(1001, pending.size)
        assertEquals(listOf("song1", "song6", "song7"), pending.take(3))
        assertEquals("song1005", pending.last())
    }

    @Test
    fun answersThatWillNeverSucceedDropTheBatchWithoutARetry() = runTest {
        for (status in listOf(400, 404, 409, 410, 413, 422)) {
            val directory = folder.newFolder()
            val sink = FakeSink(this, status)
            val log = log(sink, directory)
            var uploaded = 0
            log.onUploaded = { uploaded++ }
            log.add(play(1))
            runCurrent()
            assertTrue("status $status", log.pendingPlays.isEmpty())
            advanceTimeBy(3_600_000)
            assertEquals("status $status", 1, sink.calls.size)
            assertEquals("status $status", 0, uploaded)
            log.add(play(2))
            runCurrent()
            assertEquals("status $status", listOf("key1", "key2"), sink.calls.map { it.key })
            assertEquals("status $status", 1, uploaded)
        }
    }

    @Test
    fun aFailedBatchIsRetriedWithTheSameKeyAfterThirtySecondsDoublingToNineHundred() = runTest {
        val sink = FakeSink(this, then = 500)
        val log = log(sink)
        log.add(play(1))
        advanceTimeBy(4_000_000)
        runCurrent()
        val gaps = sink.calls.zipWithNext { a, b -> (b.atMs - a.atMs) / 1000 }
        assertEquals(listOf(30L, 60L, 120L, 240L, 480L, 900L, 900L), gaps.take(7))
        assertEquals(setOf("key1"), sink.calls.map { it.key }.toSet())
        assertEquals(setOf(listOf(play(1))), sink.calls.map { it.plays }.toSet())
        assertEquals(listOf(play(1)), log.pendingPlays)
    }

    @Test
    fun otherServerErrorsAndNoAnswerAreRetriedNotDropped() = runTest {
        for (status in listOf<Int?>(null, 401, 403, 429, 500, 503)) {
            val directory = folder.newFolder()
            val sink = FakeSink(this, status)
            val log = log(sink, directory)
            log.add(play(1))
            runCurrent()
            assertEquals("status $status", listOf(play(1)), log.pendingPlays)
            advanceTimeBy(30_000)
            runCurrent()
            assertEquals("status $status", listOf("key1", "key1"), sink.calls.map { it.key })
            assertTrue("status $status", log.pendingPlays.isEmpty())
        }
    }

    @Test
    fun aSinkThatThrowsCountsAsAFailure() = runTest {
        var calls = 0
        val log = log({ _, _ -> if (++calls == 1) error("boom") else 200 })
        log.add(play(1))
        runCurrent()
        assertEquals(1, log.pendingPlays.size)
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(2, calls)
        assertTrue(log.pendingPlays.isEmpty())
    }

    @Test
    fun aSuccessResetsTheBackoff() = runTest {
        val sink = FakeSink(this, 500, 500, 200, 500, 200)
        val log = log(sink)
        log.add(play(1))
        advanceTimeBy(91_000) // 0 s, 30 s, 90 s: failed, failed, accepted
        assertEquals(3, sink.calls.size)
        log.add(play(2))
        runCurrent()
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(5, sink.calls.size)
        assertEquals(30_000L, sink.calls[4].atMs - sink.calls[3].atMs)
        assertEquals(listOf("key1", "key1", "key1", "key2", "key2"), sink.calls.map { it.key })
    }

    @Test
    fun whileARetryWaitsNothingIsSentUnlessForced() = runTest {
        val sink = FakeSink(this, null)
        val log = log(sink)
        log.add(play(1))
        runCurrent()
        log.add(play(2))
        log.flush()
        runCurrent()
        assertEquals(1, sink.calls.size)
        // Signed in or back online: the wait is forgotten, the same batch goes first, the newer play after it.
        advanceTimeBy(5_000)
        log.flush(force = true)
        runCurrent()
        assertEquals(listOf(5_000L, 5_000L), sink.calls.drop(1).map { it.atMs })
        assertEquals(listOf("key1", "key1", "key2"), sink.calls.map { it.key })
        assertEquals(listOf(listOf("song1"), listOf("song1"), listOf("song2")), sink.calls.map { c -> c.plays.map { it.songID } })
        assertTrue(log.pendingPlays.isEmpty())
        advanceTimeBy(3_600_000)
        assertEquals(3, sink.calls.size) // the old retry timer sends nothing more
    }

    @Test
    fun addingNeverWaitsForTheServer() = runTest {
        val gate = CompletableDeferred<Int?>()
        var calls = 0
        val log = log({ _, _ ->
            calls++
            gate.await()
        })
        log.add(play(1))
        runCurrent()
        log.add(play(2))
        log.add(play(3))
        runCurrent()
        assertEquals(1, calls) // one request at a time
        assertEquals(listOf("song1", "song2", "song3"), log.pendingPlays.map { it.songID })
        gate.complete(200)
        runCurrent()
        assertEquals(2, calls)
        assertTrue(log.pendingPlays.isEmpty())
    }

    @Test
    fun theQueueAndTheBatchKeySurviveARestart() = runTest {
        val first = log(FakeSink(this, then = null))
        first.add(play(1))
        first.add(play(2))
        runCurrent()
        val sink = FakeSink(this)
        val second = PlayLog(folder.root, sink, backgroundScope, now = { currentTime }, keyFactory = { "other" })
        assertEquals(listOf("song1", "song2"), second.pendingPlays.map { it.songID })
        second.flush()
        runCurrent()
        assertEquals(listOf("key1", "other"), sink.calls.map { it.key })
        assertEquals(listOf(listOf("song1"), listOf("song2")), sink.calls.map { c -> c.plays.map { it.songID } })
        assertFalse(File(folder.root, "queue.json").readText().contains("song1"))
    }

    @Test
    fun aBrokenQueueFileStartsEmpty() = runTest {
        File(folder.root, "queue.json").writeText("{broken")
        val log = log(FakeSink(this, then = null))
        assertTrue(log.pendingPlays.isEmpty())
        log.add(play(1))
        assertEquals(1, log.pendingPlays.size)
    }

    @Test
    fun onUploadedIsCalledForEveryAcceptedBatch() = runTest {
        seed(250)
        val log = log(FakeSink(this, 204, 200))
        var uploaded = 0
        log.onUploaded = { uploaded++ }
        log.flush()
        runCurrent()
        assertEquals(2, uploaded)
    }

    @Test
    fun theRequestBodyUsesTheWireNames() {
        val body = PlayLog.body("k1", listOf(PlayRecord("2026-11-11T10:00:00.000Z", "abc", 12.5), PlayRecord("t", "def", 7.0, cont = true)))
        val json = Json.parseToJsonElement(body).jsonObject
        assertEquals(setOf("batch_key", "plays"), json.keys)
        assertEquals("k1", json["batch_key"]!!.jsonPrimitive.content)
        val first = json["plays"]!!.jsonArray[0].jsonObject
        assertEquals(setOf("timestamp", "song_id", "listened_s"), first.keys) // cont is left out when null
        assertEquals("abc", first["song_id"]!!.jsonPrimitive.content)
        assertEquals(12.5, first["listened_s"]!!.jsonPrimitive.double, 0.0)
        val second = json["plays"]!!.jsonArray[1].jsonObject
        assertEquals(setOf("timestamp", "song_id", "listened_s", "cont"), second.keys)
        assertTrue(second["cont"]!!.jsonPrimitive.boolean)
    }
}
