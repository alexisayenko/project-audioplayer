package com.alexisayenko.audioplayer.android.download

import com.alexisayenko.audioplayer.android.MemoryPause
import com.alexisayenko.audioplayer.android.apiFor
import com.alexisayenko.audioplayer.android.bytesResponse
import com.alexisayenko.audioplayer.android.jsonResponse
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The client-paced flow of AND-050 and the hourly pause of AND-052 against a scripted server, with a faked clock and no real waiting. */
class SongDownloaderTest {
    private lateinit var dir: File
    private lateinit var server: MockWebServer
    private val audio = ByteArray(500) { it.toByte() }
    private val calls = ArrayList<String>()
    private val stages = ArrayList<DownloadStage>()
    private val pause = MemoryPause()
    private var clock = 1_000_000_000L

    /** Answers by "METHOD path"; each entry is used in turn and the last one repeats. */
    private val script = HashMap<String, ArrayDeque<MockResponse>>()

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
        dir = tempDir("downloader")
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = "${request.method} ${request.url.encodedPath}"
                synchronized(calls) { calls += key }
                val queue = script[key] ?: return jsonResponse(500, """{"detail":"unscripted $key"}""")
                return if (queue.size > 1) queue.removeFirst() else queue.first()
            }
        }
        server.start()
    }

    @After
    fun tearDown() {
        server.close()
        dir.deleteRecursively()
    }

    private fun on(key: String, vararg responses: MockResponse) {
        script[key] = ArrayDeque(responses.toList())
    }

    private fun downloader() = SongDownloader(apiFor(server), target, DownloadGate(), pause, clock = { clock }, sleep = { clock += it })

    private fun run(id: String) = runBlocking { downloader().run(id, 1) { stages += it } }

    private fun song(id: String, onServer: Boolean?) = Song(id = id, title = "T", artist = "A", onServer = onServer).also { target.songs[id] = it }

    @Test
    fun aSongOnTheServerIsOnlyCopied() {
        song("abc", onServer = true)
        on("GET /files/abc", bytesResponse(200, audio))
        assertEquals(DownloadResult.Done, run("abc"))
        assertEquals(listOf("GET /files/abc"), calls)
        assertArrayEquals(audio, File(dir, "abc.m4a").readBytes())
        assertEquals(listOf("abc"), target.arrived)
        assertTrue(stages.first() is DownloadStage.Copying)
        assertEquals(DownloadStage.Copying(1f), stages.last())
    }

    @Test
    fun aSongWithoutAudioIsFetchedOnTheServerPolledThenCopied() {
        song("abc", onServer = false)
        on("GET /songs/abc/status",
            jsonResponse(200, """{"id":"abc","status":"done","progress":1.0}"""),
            jsonResponse(200, """{"id":"abc","status":"downloading","progress":0.5,"state":"downloading"}"""),
            jsonResponse(200, """{"id":"abc","status":"done","progress":1.0,"state":"done"}"""))
        on("POST /songs/abc/audio", jsonResponse(202, """{"id":"abc","status":"queued"}"""))
        on("GET /files/abc", bytesResponse(200, audio))
        val start = clock
        assertEquals(DownloadResult.Done, run("abc"))
        assertEquals(listOf("GET /songs/abc/status", "POST /songs/abc/audio", "GET /songs/abc/status", "GET /songs/abc/status", "GET /files/abc"), calls)
        assertEquals(listOf(DownloadStage.Fetching(null), DownloadStage.Fetching(null), DownloadStage.Fetching(0.5f)), stages.filterIsInstance<DownloadStage.Fetching>())
        assertEquals("two polls 1.5 s apart", 3000L, clock - start)
        assertEquals(listOf("abc"), target.arrived)
    }

    @Test
    fun aSongJustAddedIsPolledWithoutAskingForItsAudioAgain() {
        song("new", onServer = false)
        on("GET /songs/new/status",
            jsonResponse(200, """{"id":"new","status":"downloading","progress":0.2}"""),
            jsonResponse(200, """{"id":"new","status":"done","progress":1.0}"""))
        on("GET /files/new", bytesResponse(200, audio))
        assertEquals(DownloadResult.Done, run("new"))
        assertFalse(calls.any { it.startsWith("POST") })
    }

    @Test
    fun theHourlyLimitPausesAndNothingMoreIsAskedUntilItLifts() {
        song("abc", onServer = false)
        song("def", onServer = false)
        on("GET /songs/abc/status", jsonResponse(200, """{"id":"abc","status":"done"}"""))
        on("POST /songs/abc/audio", jsonResponse(429, """{"error":"hourly_limit","detail":"You can add 20 songs per hour. Try again in 12 min.","retry_after_minutes":12}""", "Retry-After" to "720"))
        val until = clock + 12 * 60_000
        assertEquals(DownloadResult.Limited(until), run("abc"))
        assertEquals(until, pause.until)
        assertFalse(File(dir, "abc.m4a").exists())

        calls.clear()
        clock += 5 * 60_000
        assertEquals(DownloadResult.Limited(until), run("def"))
        assertTrue("a paused song does not touch the server", calls.isEmpty())

        clock = until
        on("POST /songs/abc/audio", jsonResponse(200, """{"id":"abc","status":"done"}"""))
        on("GET /files/abc", bytesResponse(200, audio))
        assertEquals(DownloadResult.Done, run("abc"))
    }

    @Test
    fun aFullLibraryFailsWithTheServersWordsAndNoRetry() {
        song("abc", onServer = false)
        on("GET /songs/abc/status", jsonResponse(200, """{"id":"abc","status":"done"}"""))
        on("POST /songs/abc/audio", jsonResponse(403, """{"error":"library_full_bytes","detail":"Your storage is full (5 GB). Delete some songs to add more."}"""))
        assertEquals(DownloadResult.Failed("Your storage is full (5 GB). Delete some songs to add more."), run("abc"))
        on("POST /songs/abc/audio", jsonResponse(503, """{"error":"server_full","detail":"The server's storage is full. Try again later."}"""))
        assertEquals(DownloadResult.Failed("The server's storage is full. Try again later."), run("abc"))
        assertEquals(0L, pause.until)
    }

    @Test
    fun aFailedServerJobFailsWithTheIosWords() {
        song("abc", onServer = false)
        on("GET /songs/abc/status",
            jsonResponse(200, """{"id":"abc","status":"queued","state":"queued"}"""),
            jsonResponse(200, """{"id":"abc","status":"error","error":"x","state":"failed","error_code":"preview_only"}"""))
        assertEquals(DownloadResult.Failed("This link is only a preview, so there is no full song to download."), run("abc"))
        assertEquals(DownloadStage.Fetching(null), stages.last())
    }

    @Test
    fun serverAndNetworkTroubleAsksForARetry() {
        song("abc", onServer = true)
        on("GET /files/abc", jsonResponse(502, "Bad Gateway"))
        assertTrue(run("abc") is DownloadResult.Retry)
        assertFalse(File(dir, "abc.m4a").exists())

        song("def", onServer = false)
        on("GET /songs/def/status", jsonResponse(200, """{"id":"def","status":"downloading"}"""), jsonResponse(500, """{"detail":"boom"}"""))
        val result = run("def")
        assertTrue(result is DownloadResult.Retry)
        assertEquals("the first read and eight misses", 9, calls.count { it == "GET /songs/def/status" })
    }

    @Test
    fun anExpiredSignInFailsInWords() {
        song("abc", onServer = true)
        on("GET /files/abc", jsonResponse(401, """{"detail":"bad token"}"""))
        assertEquals(DownloadResult.Failed("Not signed in. Sign in in Settings"), run("abc"))
    }

    @Test
    fun aFileThatIsNotOnTheServerAfterAllIsFetchedThereOnce() {
        song("abc", onServer = true)
        on("GET /files/abc", jsonResponse(404, """{"detail":"not downloaded"}"""), bytesResponse(200, audio))
        on("GET /songs/abc/status", jsonResponse(200, """{"id":"abc","status":"done"}"""))
        on("POST /songs/abc/audio", jsonResponse(202, """{"id":"abc","status":"downloading"}"""))
        assertEquals(DownloadResult.Done, run("abc"))
        assertEquals(listOf("GET /files/abc", "GET /songs/abc/status", "POST /songs/abc/audio", "GET /songs/abc/status", "GET /files/abc"), calls)
    }

    @Test
    fun aSongThatLeftTheLibraryOrIsAlreadyHereNeedsNoServer() {
        assertEquals(DownloadResult.Failed("The song left the library"), run("ghost"))
        song("abc", onServer = true)
        target.arrived += "abc"
        assertEquals(DownloadResult.Done, run("abc"))
        assertTrue(calls.isEmpty())
        song("gone", onServer = false)
        on("GET /songs/gone/status", jsonResponse(404, """{"detail":"unknown song"}"""))
        on("POST /songs/gone/audio", jsonResponse(404, """{"detail":"unknown song"}"""))
        assertEquals(DownloadResult.Failed("The song left the library"), run("gone"))
    }
}
