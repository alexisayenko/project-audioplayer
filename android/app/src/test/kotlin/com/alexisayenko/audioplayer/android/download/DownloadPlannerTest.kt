package com.alexisayenko.audioplayer.android.download

import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.download.DownloadPlanner.Kind
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The planner and the hourly pause with a faked clock, after `AlbumRunTests` in `ios/Tests/AlbumTests.swift`. */
@OptIn(ExperimentalCoroutinesApi::class)
class DownloadPlannerTest {
    private val t0 = 1_000_000_000L

    @Test
    fun startsSongsInQueueOrderTwoCopiesAtATime() {
        val planner = DownloadPlanner()
        planner.request("c", Kind.Copy, 3)
        planner.request("a", Kind.Copy, 1)
        planner.request("b", Kind.Copy, 2)
        assertEquals(listOf("a", "b"), planner.grant().map { it.id })
        assertTrue(planner.grant().isEmpty())
        assertEquals(listOf("c"), planner.waitingIds)
        planner.release("a")
        assertEquals(listOf("c"), planner.grant().map { it.id })
        assertEquals(setOf("b", "c"), planner.runningIds)
        assertEquals(2, planner.activeCount)
    }

    @Test
    fun onlyOneServerFetchRunsAtATime() {
        val planner = DownloadPlanner()
        planner.request("f1", Kind.Fetch, 1)
        planner.request("f2", Kind.Fetch, 2)
        planner.request("f3", Kind.Fetch, 3)
        assertEquals(listOf("f1"), planner.grant().map { it.id })
        assertTrue(planner.grant().isEmpty())
        planner.release("f1")
        assertEquals(listOf("f2"), planner.grant().map { it.id })
        assertEquals(1, planner.running(Kind.Fetch))
    }

    @Test
    fun aWaitingFetchDoesNotHoldBackCopies() {
        val planner = DownloadPlanner()
        planner.request("f1", Kind.Fetch, 1)
        planner.request("f2", Kind.Fetch, 2)
        planner.request("c1", Kind.Copy, 3)
        planner.request("c2", Kind.Copy, 4)
        planner.request("c3", Kind.Copy, 5)
        assertEquals(listOf("f1", "c1", "c2"), planner.grant().map { it.id })
        assertEquals(1, planner.running(Kind.Fetch))
        assertEquals(2, planner.running(Kind.Copy))
        assertEquals(listOf("f2", "c3"), planner.waitingIds)
        assertEquals(5, planner.activeCount)
    }

    @Test
    fun equalOrderIsBrokenByIdAndAskingAgainReplacesTheRequest() {
        val planner = DownloadPlanner(maxCopies = 1)
        planner.request("b", Kind.Copy, 1)
        planner.request("a", Kind.Copy, 1)
        planner.request("b", Kind.Copy, 0)
        assertEquals(listOf("b", "a"), planner.waitingIds)
        assertEquals(listOf("b"), planner.grant().map { it.id })
        planner.request("b", Kind.Copy, 9)
        assertEquals(listOf("a"), planner.waitingIds)
        planner.release("a")
        planner.release("b")
        assertEquals(0, planner.activeCount)
        assertTrue(planner.grant().isEmpty())
    }

    @Test
    fun hourlyLimitPausesAndResumesWithFakedClock() {
        val until = HourlyLimit.pauseUntil(t0, 12)
        assertTrue(HourlyLimit.isPaused(t0 + 60_000, until))
        assertEquals("Paused: hourly limit, resumes in 11 min", HourlyLimit.pauseText(t0 + 60_000, until))
        assertTrue(HourlyLimit.isPaused(t0 + 719_000, until))
        assertEquals(1, HourlyLimit.minutesLeft(t0 + 719_000, until))
        assertFalse(HourlyLimit.isPaused(t0 + 720_000, until))
        assertNull(HourlyLimit.pauseText(t0 + 720_000, until))
        assertEquals(0, HourlyLimit.minutesLeft(t0 + 800_000, until))
        assertEquals(0L, HourlyLimit.remainingMs(t0, 0))
    }

    @Test
    fun limitWaitsAtLeastOneMinute() {
        assertEquals(60_000L, HourlyLimit.remainingMs(t0, HourlyLimit.pauseUntil(t0, 0)))
        assertEquals(60_000L, HourlyLimit.remainingMs(t0, HourlyLimit.pauseUntil(t0, -5)))
        assertEquals("Paused: hourly limit, resumes in 1 min", HourlyLimit.pauseText(t0, HourlyLimit.pauseUntil(t0, 0)))
    }

    @Test
    fun retryMinutesReadsTheRefusalText() {
        assertEquals(37, HourlyLimit.retryMinutes("You can add 20 songs per hour. Try again in 37 min."))
        assertEquals(1, HourlyLimit.retryMinutes("Try again later"))
        assertEquals(1, HourlyLimit.retryMinutes("Try again in 0 min."))
    }

    @Test
    fun theGateLetsTwoCopiesRunAndTheThirdWait() = runTest {
        val gate = DownloadGate()
        val running = ArrayList<String>()
        val waited = ArrayList<String>()
        val doors = listOf("a", "b", "c").associateWith { CompletableDeferred<Unit>() }
        val jobs = doors.keys.mapIndexed { i, id ->
            async {
                gate.withSlot(id, Kind.Copy, i.toLong(), onWait = { waited += id }) {
                    running += id
                    doors.getValue(id).await()
                    id
                }
            }
        }
        runCurrent()
        assertEquals(listOf("a", "b"), running)
        assertEquals(listOf("c"), waited)
        assertEquals(3, gate.activeCount)
        doors.getValue("a").complete(Unit)
        runCurrent()
        assertEquals(listOf("a", "b", "c"), running)
        doors.values.forEach { it.complete(Unit) }
        assertEquals(listOf("a", "b", "c"), jobs.map { it.await() })
        assertEquals(0, gate.activeCount)
    }

    @Test
    fun aCancelledWaiterLeavesTheLineAndAFailedBlockFreesItsSlot() = runTest {
        val gate = DownloadGate(DownloadPlanner(maxCopies = 1))
        val door = CompletableDeferred<Unit>()
        val first = launch { runCatching { gate.withSlot("a", Kind.Copy, 1) { door.await(); error("boom") } } }
        val second = launch { gate.withSlot("b", Kind.Copy, 2) { } }
        var third = false
        val last = launch { gate.withSlot("c", Kind.Copy, 3) { third = true } }
        runCurrent()
        assertEquals(3, gate.activeCount)
        second.cancelAndJoin()
        assertEquals(2, gate.activeCount)
        door.complete(Unit)
        first.join()
        last.join()
        assertTrue(third)
        assertEquals(0, gate.activeCount)
    }

    @Test
    fun workStatesMapToTheTransferTheRowShows() {
        fun work(state: WorkSnapshot.State, stage: String? = null, progress: Float? = null, message: String? = null, paused: Long? = null) =
            WorkSnapshot("a", state, stage, progress, message, paused)
        assertEquals(Transfer.Waiting, TransferMapper.map(work(WorkSnapshot.State.Enqueued), t0))
        assertEquals(Transfer.Waiting, TransferMapper.map(work(WorkSnapshot.State.Blocked), t0))
        assertEquals(Transfer.Paused(t0 + 5), TransferMapper.map(work(WorkSnapshot.State.Enqueued, paused = t0 + 5), t0))
        assertEquals(Transfer.Waiting, TransferMapper.map(work(WorkSnapshot.State.Enqueued, paused = t0 - 5), t0))
        assertEquals(Transfer.Waiting, TransferMapper.map(work(WorkSnapshot.State.Running), t0))
        assertEquals(Transfer.Waiting, TransferMapper.map(work(WorkSnapshot.State.Running, TransferMapper.STAGE_WAITING), t0))
        assertEquals(Transfer.Fetching(null), TransferMapper.map(work(WorkSnapshot.State.Running, TransferMapper.STAGE_FETCHING), t0))
        assertEquals(Transfer.Fetching(0.4f), TransferMapper.map(work(WorkSnapshot.State.Running, TransferMapper.STAGE_FETCHING, 0.4f), t0))
        assertEquals(Transfer.Copying(0.75f), TransferMapper.map(work(WorkSnapshot.State.Running, TransferMapper.STAGE_COPYING, 0.75f), t0))
        assertEquals(Transfer.Copying(0f), TransferMapper.map(work(WorkSnapshot.State.Running, TransferMapper.STAGE_COPYING), t0))
        assertEquals(Transfer.Failed("Your library is full."), TransferMapper.map(work(WorkSnapshot.State.Failed, message = "Your library is full."), t0))
        assertEquals(Transfer.Failed(TransferMapper.DEFAULT_FAILURE), TransferMapper.map(work(WorkSnapshot.State.Failed), t0))
        assertNull(TransferMapper.map(work(WorkSnapshot.State.Succeeded), t0))
        assertNull(TransferMapper.map(work(WorkSnapshot.State.Cancelled), t0))
    }

    @Test
    fun oneTransferPerSongAndTheLiveWorkWins() {
        val works = listOf(
            WorkSnapshot("a", WorkSnapshot.State.Failed, message = "old"),
            WorkSnapshot("a", WorkSnapshot.State.Running, TransferMapper.STAGE_COPYING, 0.5f),
            WorkSnapshot("b", WorkSnapshot.State.Succeeded),
            WorkSnapshot("c", WorkSnapshot.State.Enqueued, pausedUntilMs = t0 + 60_000),
            WorkSnapshot("d", WorkSnapshot.State.Cancelled),
        )
        assertEquals(mapOf("a" to Transfer.Copying(0.5f), "c" to Transfer.Paused(t0 + 60_000)), TransferMapper.transfers(works, t0))
    }

    @Test
    fun progressDataRoundTripsThroughTheWorkKeys() {
        val copying = DownloadWork.progressData(DownloadStage.Copying(0.25f))
        assertEquals(TransferMapper.STAGE_COPYING, copying.getString(DownloadWork.KEY_STAGE))
        assertEquals(0.25f, copying.getFloat(DownloadWork.KEY_PROGRESS, -1f), 0f)
        assertEquals(-1f, DownloadWork.progressData(DownloadStage.Fetching(null)).getFloat(DownloadWork.KEY_PROGRESS, 0f), 0f)
        assertEquals(TransferMapper.STAGE_WAITING, DownloadWork.progressData(DownloadStage.Waiting).getString(DownloadWork.KEY_STAGE))
        assertEquals("download:abc", DownloadWork.name("abc"))
        assertEquals("Downloading 3 songs", DownloadWorker.summary(3))
        assertEquals("Downloading 1 song", DownloadWorker.summary(0))
    }
}
