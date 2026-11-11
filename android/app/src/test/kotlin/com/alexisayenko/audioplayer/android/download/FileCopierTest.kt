package com.alexisayenko.audioplayer.android.download

import com.alexisayenko.audioplayer.android.apiFor
import com.alexisayenko.audioplayer.android.bytesResponse
import com.alexisayenko.audioplayer.android.data.api.ApiError
import com.alexisayenko.audioplayer.android.download.RangeMath.Step
import com.alexisayenko.audioplayer.android.jsonResponse
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The Range resume loop of AND-053 against a server that behaves like `GET /files/{id}` with the 768 KiB cap (here a few bytes). */
class FileCopierTest {
    private lateinit var dir: File
    private lateinit var server: MockWebServer
    private lateinit var copier: FileCopier
    private lateinit var part: File
    private lateinit var dest: File
    private val content = ByteArray(1000) { (it % 251).toByte() }

    @Before
    fun setUp() {
        dir = tempDir("copier")
        server = MockWebServer()
        server.start()
        copier = FileCopier(apiFor(server))
        dest = File(dir, "Artist - Song.m4a")
        part = File(dest.path + ".part")
    }

    @After
    fun tearDown() {
        server.close()
        dir.deleteRecursively()
    }

    /** Serves [bytes] like the real endpoint: 200 without a Range, else 206 with at most [cap] bytes; `If-Range` that does not match answers 200. */
    private fun fileServer(bytes: ByteArray, cap: Int, etag: String = "\"v1\"", breakAfterFirst: Int? = null): MutableList<RecordedRequest> {
        val seen = ArrayList<RecordedRequest>()
        var first = true
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                synchronized(seen) { seen += request }
                val range = request.headers["Range"]
                val ifRange = request.headers["If-Range"]
                if (range == null || (ifRange != null && ifRange != etag)) {
                    if (first && breakAfterFirst != null) {
                        first = false
                        return MockResponse.Builder().code(200).body(Buffer().write(bytes, 0, breakAfterFirst))
                            .setHeader("Content-Length", bytes.size).setHeader("ETag", etag).build()
                    }
                    return bytesResponse(200, bytes, "ETag" to etag)
                }
                val start = range.removePrefix("bytes=").removeSuffix("-").toInt()
                if (start >= bytes.size) return MockResponse.Builder().code(416).setHeader("Content-Range", "bytes */${bytes.size}").build()
                val end = minOf(bytes.size, start + cap) - 1
                return bytesResponse(206, bytes.copyOfRange(start, end + 1), "Content-Range" to "bytes $start-$end/${bytes.size}", "ETag" to etag)
            }
        }
        return seen
    }

    @Test
    fun rangeMathDecidesWhatAnAnswerMeans() {
        assertNull(RangeMath.rangeHeader(0))
        assertEquals("bytes=4096-", RangeMath.rangeHeader(4096))
        assertEquals(RangeMath.ContentRange(100, 199, 1000), RangeMath.parseContentRange("bytes 100-199/1000"))
        assertEquals(RangeMath.ContentRange(0, 9, null), RangeMath.parseContentRange("bytes 0-9/*"))
        assertNull(RangeMath.parseContentRange("bytes 9-0/10"))
        assertNull(RangeMath.parseContentRange("items 0-9/10"))
        assertNull(RangeMath.parseContentRange(null))
        assertEquals(1000L, RangeMath.parseUnsatisfiedTotal("bytes */1000"))

        assertEquals(Step.Restart(1000), RangeMath.decide(0, null, 200, null, 1000))
        assertEquals(Step.Restart(1000), RangeMath.decide(300, 1000, 200, null, 1000))
        assertEquals(Step.Restart(null), RangeMath.decide(0, null, 200, null, null))
        assertEquals(Step.Append(1000), RangeMath.decide(300, 1000, 206, "bytes 300-599/1000", 300))
        assertEquals(Step.Append(1000), RangeMath.decide(300, null, 206, "bytes 300-599/1000", 300))
        assertEquals(Step.Append(1000), RangeMath.decide(300, 1000, 206, "bytes 300-599/*", 300))
        assertEquals(Step.Discard, RangeMath.decide(300, 1000, 206, "bytes 0-299/1000", 300))
        assertEquals(Step.Discard, RangeMath.decide(300, 1000, 206, "bytes 300-599/2000", 300))
        assertEquals(Step.Discard, RangeMath.decide(300, 1000, 206, null, 300))
        assertEquals(Step.Complete, RangeMath.decide(1000, 1000, 416, "bytes */1000", 0))
        assertEquals(Step.Discard, RangeMath.decide(1200, 1000, 416, "bytes */1000", 0))
        assertEquals(Step.Discard, RangeMath.decide(0, null, 500, null, 0))

        assertTrue(RangeMath.isComplete(1000, 1000))
        assertFalse(RangeMath.isComplete(999, 1000))
        assertTrue(RangeMath.isComplete(5, null))
        assertEquals(0.5f, RangeMath.fraction(500, 1000), 0f)
        assertEquals(0f, RangeMath.fraction(500, null), 0f)
        assertEquals(1f, RangeMath.fraction(1500, 1000), 0f)
    }

    @Test
    fun aFreshCopyIsOnePlainGet() = runBlocking {
        val seen = fileServer(content, cap = 300)
        val progress = ArrayList<Float>()
        copier.copy("abc", part, dest) { progress += it }
        assertArrayEquals(content, dest.readBytes())
        assertFalse(part.exists())
        assertFalse(File(part.path + ".meta").exists())
        assertEquals(1, seen.size)
        assertNull(seen[0].headers["Range"])
        assertEquals(1f, progress.last(), 0f)
        assertEquals(progress.sorted(), progress)
    }

    @Test
    fun anInterruptedCopyResumesAndLoopsOverCappedAnswers() = runBlocking {
        val seen = fileServer(content, cap = 300, breakAfterFirst = 250)
        val failure = runCatching { copier.copy("abc", part, dest) }.exceptionOrNull()
        assertTrue("the broken transfer is an IOException, got $failure", failure is IOException)
        assertFalse("a failed copy leaves no file under the final name", dest.exists())
        assertEquals(250L, part.length())

        copier.copy("abc", part, dest)
        assertArrayEquals(content, dest.readBytes())
        assertFalse(part.exists())
        assertEquals(listOf(null, "bytes=250-", "bytes=550-", "bytes=850-"), seen.map { it.headers["Range"] })
        assertEquals(listOf(null, "\"v1\"", "\"v1\"", "\"v1\""), seen.map { it.headers["If-Range"] })
    }

    @Test
    fun aPartialFileWithoutItsNoteIsStartedAgain() = runBlocking {
        part.writeBytes(ByteArray(100) { 7 })
        val seen = fileServer(content, cap = 300)
        copier.copy("abc", part, dest)
        assertArrayEquals(content, dest.readBytes())
        assertNull(seen.single().headers["Range"])
    }

    @Test
    fun aFileThatChangedOnTheServerIsFetchedFromTheStart() = runBlocking {
        part.writeBytes(ByteArray(400) { 9 })
        File(part.path + ".meta").writeText("\"old\"\n5000")
        val seen = fileServer(content, cap = 300, etag = "\"v2\"")
        copier.copy("abc", part, dest)
        assertArrayEquals(content, dest.readBytes())
        assertEquals("bytes=400-", seen.single().headers["Range"])
    }

    @Test
    fun aDifferentTotalWithoutAValidatorDiscardsThePartialFile() = runBlocking {
        part.writeBytes(ByteArray(400) { 9 })
        File(part.path + ".meta").writeText("\n5000")
        val seen = fileServer(content, cap = 300)
        copier.copy("abc", part, dest)
        assertArrayEquals(content, dest.readBytes())
        assertEquals(listOf("bytes=400-", null), seen.map { it.headers["Range"] })
    }

    @Test
    fun aCompletePartialFileIsOnlyRenamed() = runBlocking {
        part.writeBytes(content)
        File(part.path + ".meta").writeText("\"v1\"\n1000")
        val seen = fileServer(content, cap = 300)
        copier.copy("abc", part, dest)
        assertArrayEquals(content, dest.readBytes())
        assertTrue(seen.isEmpty())
    }

    @Test
    fun moreBytesThanAnnouncedIsALengthMismatchAndLeavesNothing() = runBlocking {
        part.writeBytes(ByteArray(5))
        File(part.path + ".meta").writeText("\n8")
        server.enqueue(bytesResponse(206, ByteArray(5), "Content-Range" to "bytes 5-9/8"))
        val failure = runCatching { copier.copy("abc", part, dest) }.exceptionOrNull()
        assertTrue(failure is LengthMismatch)
        assertEquals(8L, (failure as LengthMismatch).expected)
        assertEquals(10L, failure.actual)
        assertFalse(dest.exists())
        assertFalse(part.exists())
    }

    @Test
    fun aServerThatSendsNothingEndsTheCopyInsteadOfLoopingForever() = runBlocking {
        part.writeBytes(ByteArray(5))
        File(part.path + ".meta").writeText("\n8")
        repeat(3) { server.enqueue(bytesResponse(206, ByteArray(0), "Content-Range" to "bytes 5-5/8")) }
        val failure = runCatching { copier.copy("abc", part, dest) }.exceptionOrNull()
        assertTrue(failure is IOException)
        assertFalse(dest.exists())
        assertEquals(3, server.requestCount)
    }

    @Test
    fun aRefusalIsThrownAsTheApiErrorAndLeavesNoFile() = runBlocking {
        server.enqueue(jsonResponse(404, """{"detail":"not downloaded"}"""))
        val failure = runCatching { copier.copy("abc", part, dest) }.exceptionOrNull()
        assertEquals(404, (failure as ApiError).httpStatus)
        assertFalse(dest.exists())
        assertFalse(part.exists())
    }

    @Test
    fun aCancelledCopyLeavesNoFileUnderTheFinalName() = runBlocking {
        server.enqueue(
            MockResponse.Builder().code(200).body(Buffer().write(content))
                .throttleBody(100, 200, java.util.concurrent.TimeUnit.MILLISECONDS).setHeader("ETag", "\"v1\"").build(),
        )
        val started = kotlinx.coroutines.CompletableDeferred<Unit>()
        val job = async(Dispatchers.IO) {
            runCatching { copier.copy("abc", part, dest) { if (it > 0f) started.complete(Unit) } }.exceptionOrNull()
        }
        started.await()
        job.cancelAndJoin()
        assertTrue(job.isCancelled)
        assertFalse(dest.exists())
        assertTrue("the partial file stays for the next attempt", part.exists() && part.length() in 1 until 1000)
    }
}
