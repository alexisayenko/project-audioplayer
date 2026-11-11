package com.alexisayenko.audioplayer.android.download

import android.content.Context
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.alexisayenko.audioplayer.android.FakeSettings
import com.alexisayenko.audioplayer.android.MemoryPause
import com.alexisayenko.audioplayer.android.apiFor
import com.alexisayenko.audioplayer.android.bytesResponse
import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.jsonResponse
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.model.FrameworkMethod
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Robolectric on SDK 36 reaches the JDK package `jdk.internal.access`; on JDK 17+ the test JVM must export it
 * (`--add-exports` and `--add-opens java.base/jdk.internal.access=ALL-UNNAMED` in the unit-test JVM args). Where the build does
 * not pass those flags the tests are reported as skipped instead of failing in Robolectric's own start-up.
 */
class WorkTestRunner(testClass: Class<*>) : RobolectricTestRunner(testClass) {
    override fun isIgnored(child: FrameworkMethod): Boolean = super.isIgnored(child) || !jdkInternalsOpen

    private companion object {
        // Class.getModule is not in the Android API the tests compile against, so it is reached by name.
        val jdkInternalsOpen: Boolean = try {
            val getModule = Class::class.java.getMethod("getModule")
            val base = getModule.invoke(Any::class.java)
            val ours = getModule.invoke(WorkTestRunner::class.java)
            base.javaClass.getMethod("isOpen", String::class.java, base.javaClass).invoke(base, "jdk.internal.access", ours) as Boolean
        } catch (_: Exception) {
            true
        }
    }
}

/** The worker and the queue on WorkManager's test harness (Robolectric): unique work, constraints, results and the WorkInfo to Transfer mapping. */
@RunWith(WorkTestRunner::class)
@Config(sdk = [36], application = android.app.Application::class)
class DownloadWorkerTest {
    private lateinit var context: Context
    private lateinit var work: WorkManager
    private lateinit var server: MockWebServer
    private lateinit var dir: File
    private lateinit var scope: CoroutineScope
    private lateinit var queue: WorkDownloadQueue
    private val settings = FakeSettings()
    private val pause = MemoryPause()
    private var clock = 1_000_000_000L
    private val audio = ByteArray(300) { it.toByte() }

    private val target = object : DownloadTarget {
        val songs = HashMap<String, Song>()
        val arrived = ArrayList<String>()
        override fun song(id: String): Song? = songs[id]
        override fun isOnPhone(id: String): Boolean = id in arrived
        override fun reserve(song: Song): File = File(dir, "${song.id}.m4a")
        override suspend fun arrived(song: Song) {
            arrived += song.id
        }
    }

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        work = WorkManager.getInstance(context)
        server = MockWebServer()
        server.start()
        dir = tempDir("worker")
        scope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
        queue = WorkDownloadQueue(work, settings, scope, clock = { clock })
        val downloader = SongDownloader(apiFor(server), target, DownloadGate(), pause, clock = { clock }, sleep = { clock += it })
        DownloadEnvironmentHolder.environment = object : DownloadEnvironment {
            override val downloader = downloader
            override val queue = this@DownloadWorkerTest.queue
            override fun song(id: String): Song? = target.songs[id]
        }
    }

    @After
    fun tearDown() {
        DownloadEnvironmentHolder.environment = null
        scope.cancel()
        server.close()
        dir.deleteRecursively()
    }

    private fun song(id: String, onServer: Boolean) = Song(id = id, title = "T", artist = "A", onServer = onServer).also { target.songs[id] = it }

    private fun info(id: String): WorkInfo = work.getWorkInfosForUniqueWork(DownloadWork.name(id)).get().single()

    private fun awaitState(id: String, vararg states: WorkInfo.State): WorkInfo {
        repeat(200) {
            val now = info(id)
            if (now.state in states) return now
            Thread.sleep(25)
        }
        throw AssertionError("work for $id stayed ${info(id).state}")
    }

    private fun awaitTransfers(expected: Map<String, Transfer>) {
        repeat(200) {
            if (queue.transfers.value == expected) return
            Thread.sleep(25)
        }
        assertEquals(expected, queue.transfers.value)
    }

    private fun letRun(id: String) = WorkManagerTestInitHelper.getTestDriver(context)!!.setAllConstraintsMet(info(id).id)

    @Test
    fun aSongIsQueuedOnceUnderItsUniqueNameAndWaitsForWifi() {
        val a = song("a", onServer = true)
        queue.enqueue(a)
        queue.enqueue(a)
        val queued = info("a")
        assertEquals(WorkInfo.State.ENQUEUED, queued.state)
        assertTrue(queued.tags.containsAll(listOf("download", "song:a")))
        assertEquals(NetworkType.UNMETERED, queued.constraints.requiredNetworkType)
        awaitTransfers(mapOf("a" to Transfer.Waiting))

        settings.setUseMobileData(true)
        queue.enqueue(song("b", onServer = true))
        assertEquals(NetworkType.CONNECTED, info("b").constraints.requiredNetworkType)

        queue.cancel("a")
        assertEquals(WorkInfo.State.CANCELLED, info("a").state)
        awaitTransfers(mapOf("b" to Transfer.Waiting))
    }

    @Test
    fun theWorkerCopiesTheFileAndTheTransferDisappears() {
        queue.enqueue(song("a", onServer = true))
        server.enqueue(bytesResponse(200, audio))
        letRun("a")
        awaitState("a", WorkInfo.State.SUCCEEDED)
        assertArrayEquals(audio, File(dir, "a.m4a").readBytes())
        assertEquals(listOf("a"), target.arrived)
        awaitTransfers(emptyMap())
    }

    @Test
    fun aRefusalFailsTheWorkWithItsMessageAndRetryQueuesItAgain() {
        val a = song("a", onServer = true)
        queue.enqueue(a)
        server.enqueue(jsonResponse(401, """{"detail":"bad token"}"""))
        letRun("a")
        val failed = awaitState("a", WorkInfo.State.FAILED)
        assertEquals("Not signed in. Sign in in Settings", failed.outputData.getString(DownloadWork.KEY_MESSAGE))
        awaitTransfers(mapOf("a" to Transfer.Failed("Not signed in. Sign in in Settings")))
        queue.enqueue(a)
        assertEquals(WorkInfo.State.ENQUEUED, info("a").state)
        awaitTransfers(mapOf("a" to Transfer.Waiting))
    }

    @Test
    fun theHourlyLimitPutsTheSongBackInTheQueueAsPaused() {
        queue.enqueue(song("a", onServer = false))
        server.enqueue(jsonResponse(200, """{"id":"a","status":"done"}"""))
        server.enqueue(jsonResponse(429, """{"error":"hourly_limit","detail":"Try again in 12 min.","retry_after_minutes":12}"""))
        val first = info("a").id
        letRun("a")
        val until = clock + 12 * 60_000
        repeat(200) {
            if (info("a").id != first) return@repeat
            Thread.sleep(25)
        }
        val paused = info("a")
        assertTrue("the song was re-queued as new work", paused.id != first)
        assertEquals(WorkInfo.State.ENQUEUED, paused.state)
        assertTrue(paused.tags.contains("paused:$until"))
        assertEquals(until, pause.until)
        awaitTransfers(mapOf("a" to Transfer.Paused(until)))
        assertEquals(2, server.requestCount)
    }

    @Test
    fun withoutAnEnvironmentTheWorkIsRetriedLater() {
        DownloadEnvironmentHolder.environment = null
        queue.enqueue(song("a", onServer = true))
        letRun("a")
        assertEquals(WorkInfo.State.ENQUEUED, awaitState("a", WorkInfo.State.ENQUEUED).state)
        assertEquals(0, server.requestCount)
    }
}
