package com.alexisayenko.audioplayer.android.data

import com.alexisayenko.audioplayer.android.apiFor
import com.alexisayenko.audioplayer.android.bytesResponse
import com.alexisayenko.audioplayer.android.data.api.ApiClient
import com.alexisayenko.audioplayer.android.data.api.ApiError
import com.alexisayenko.audioplayer.android.data.api.BearerInterceptor
import com.alexisayenko.audioplayer.android.data.api.Payloads
import com.alexisayenko.audioplayer.android.fixtureJson
import com.alexisayenko.audioplayer.android.jsonResponse
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.testHttp
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockWebServer
import okhttp3.Request
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var api: ApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = apiFor(server)
    }

    @After
    fun tearDown() {
        server.close()
    }

    private inline fun <reified E : ApiError> failing(crossinline block: suspend () -> Unit): E {
        try {
            runBlocking { block() }
        } catch (e: ApiError) {
            if (e is E) return e
            fail("expected ${E::class.simpleName}, got $e")
        }
        fail("expected ${E::class.simpleName}, got success")
        throw IllegalStateException()
    }

    @Test
    fun catalogSendsTheBearerTokenAndReturnsTheEtag() = runBlocking {
        server.enqueue(jsonResponse(200, """{"revision":"r1","ids":["a"],"songs":[{"id":"a","title":"A","audio_state":"server"}]}""", "ETag" to "\"r1\""))
        val result = api.catalog(null)!!
        assertEquals("\"r1\"", result.etag)
        assertEquals(listOf("a"), result.catalog.songs.map { it.id })
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/catalog", request.url.encodedPath)
        assertEquals("Bearer tok", request.headers["Authorization"])
        assertNull(request.headers["If-None-Match"])
        assertNull(request.headers["Cookie"])
        assertNull(request.headers["X-API-Token"])
        assertEquals(true, api.reachability.state.value)
    }

    @Test
    fun aNotModifiedCatalogIsNull() = runBlocking {
        server.enqueue(jsonResponse(304, "", "ETag" to "\"r1\""))
        assertNull(api.catalog("\"r1\""))
        assertEquals("\"r1\"", server.takeRequest().headers["If-None-Match"])
    }

    @Test
    fun signedOutCallsCarryNoAuthorization() = runBlocking {
        server.enqueue(jsonResponse(401, """{"detail":"bad token"}"""))
        val error = failing<ApiError.Http> { apiFor(server, token = null).verify() }
        assertTrue(error.isUnauthorized)
        assertNull(server.takeRequest().headers["Authorization"])
    }

    @Test
    fun refusalsAreMappedFromStatusBodyAndRetryAfter() {
        server.enqueue(jsonResponse(429, """{"error":"hourly_limit","detail":"You can add 20 songs per hour. Try again in 12 min.","retry_after_minutes":12}""", "Retry-After" to "720"))
        val limit = failing<ApiError.Refused> { api.requestAudio("abc") }
        assertTrue(limit.isHourlyLimit)
        assertEquals(12, limit.retryAfterMinutes)

        server.enqueue(jsonResponse(429, """{"error":"hourly_limit","detail":"Slow down."}""", "Retry-After" to "1800"))
        assertEquals(30, failing<ApiError.Refused> { api.requestAudio("abc") }.waitMinutes)

        server.enqueue(jsonResponse(403, """{"error":"library_full_songs","detail":"Your library is full (500 songs). Delete some songs to add more."}"""))
        val full = failing<ApiError.Refused> { api.addSong("https://youtu.be/x", Payloads.addMetadata(Song("x", "T")), emptyList()) }
        assertTrue(full.isLibraryFull)

        server.enqueue(jsonResponse(503, """{"error":"server_full","detail":"The server's storage is full. Try again later."}"""))
        assertTrue(failing<ApiError.Refused> { api.requestAudio("abc") }.isServerFull)

        server.enqueue(jsonResponse(422, """{"detail":[{"msg":"title must not be empty"}],"error":"unprocessable"}"""))
        assertEquals("title must not be empty", failing<ApiError.Http> { api.updateSong("abc", Payloads.edit(Song("abc", ""))) }.message)

        server.enqueue(jsonResponse(403, """{"error":"not_allowed","detail":"no"}"""))
        failing<ApiError.Forbidden> { api.verify() }

        server.enqueue(jsonResponse(200, "not json"))
        failing<ApiError.Unreadable> { api.status("abc") }
    }

    @Test
    fun anUnreachableServerIsReportedAsUnreachable() {
        val dead = apiFor(server)
        server.close()
        failing<ApiError.Unreachable> { dead.verify() }
        assertEquals(false, dead.reachability.state.value)
    }

    @Test
    fun aSilentServerIsATimeout() {
        server.enqueue(mockwebserver3.MockResponse.Builder().code(200).body("{}").headersDelay(3, java.util.concurrent.TimeUnit.SECONDS).build())
        failing<ApiError.Timeout> { api.verify() }
    }

    @Test
    fun addEditDeleteAndStatusUseTheIosRequests() = runBlocking {
        val requests = fixtureJson("ios_contract.json")["requests"]!!.jsonObject
        val song = Song(id = "dQw4w9WgXcQ", title = "Song", artist = "Band", sourceURL = "https://youtu.be/dQw4w9WgXcQ")

        server.enqueue(jsonResponse(202, """{"id":"dQw4w9WgXcQ","status":"downloading"}"""))
        api.addSong(song.sourceURL!!, Payloads.addMetadata(song), emptyList())
        val add = server.takeRequest()
        assertEquals("POST", add.method)
        assertEquals("/songs", add.url.encodedPath)
        val sent = Json.parseToJsonElement(add.body!!.utf8()).jsonObject
        assertEquals(requests["add"]!!.jsonObject, sent - "audio")
        assertEquals("true", sent["audio"].toString())
        assertTrue(add.headers["Content-Type"]!!.startsWith("application/json"))

        server.enqueue(jsonResponse(200, """{"id":"dQw4w9WgXcQ","title":"Song","artist":"Band","audio_state":"server"}"""))
        val updated = api.updateSong(song.id, Payloads.edit(song))
        assertEquals("Band", updated.artist)
        val edit = server.takeRequest()
        assertEquals("PATCH", edit.method)
        assertEquals("/songs/dQw4w9WgXcQ", edit.url.encodedPath)
        assertEquals(requests["edit"], Json.parseToJsonElement(edit.body!!.utf8()))

        server.enqueue(jsonResponse(204, ""))
        api.deleteSong(song.id)
        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertEquals("/songs/dQw4w9WgXcQ", delete.url.encodedPath)

        server.enqueue(jsonResponse(202, """{"id":"dQw4w9WgXcQ","status":"queued"}"""))
        assertTrue(api.requestAudio(song.id).isQueued)
        val audio = server.takeRequest()
        assertEquals("POST", audio.method)
        assertEquals("/songs/dQw4w9WgXcQ/audio", audio.url.encodedPath)

        server.enqueue(jsonResponse(200, """{"id":"dQw4w9WgXcQ","status":"downloading","progress":0.4,"state":"downloading","percent":40}"""))
        assertEquals(0.4, api.status(song.id).progress!!, 0.0001)
        assertEquals("/songs/dQw4w9WgXcQ/status", server.takeRequest().url.encodedPath)
    }

    @Test
    fun previewUsagePlaysTagsGenresAndMetadata() = runBlocking {
        server.enqueue(jsonResponse(200, """{"id":"abc","source":"youtube","source_url":"https://youtu.be/abc","title":"T","artist":"A","in_library":false}"""))
        assertEquals("abc", api.preview("https://youtu.be/abc?si=x").id)
        val preview = server.takeRequest()
        assertEquals("/preview", preview.url.encodedPath)
        assertEquals("""{"url":"https://youtu.be/abc?si=x"}""", preview.body!!.utf8())

        server.enqueue(jsonResponse(200, """{"songs":3,"max_songs":500,"bytes":10,"max_bytes":100,"adds_last_hour":1,"max_adds":20}"""))
        assertEquals(19, api.usage().fetchesLeft)
        assertEquals("/me/usage", server.takeRequest().url.encodedPath)

        server.enqueue(jsonResponse(503, """{"detail":"starting"}"""))
        assertEquals(503, api.postPlays("""{"plays":[]}"""))
        val plays = server.takeRequest()
        assertEquals("/plays", plays.url.encodedPath)
        assertEquals("""{"plays":[]}""", plays.body!!.utf8())
        assertEquals("Bearer tok", plays.headers["Authorization"])

        server.enqueue(jsonResponse(200, """[{"tag":"genre:house","count":2}]"""))
        assertEquals("genre:house", api.tags().single().tag)
        server.takeRequest()

        server.enqueue(jsonResponse(200, """{"genres":["house",5,"techno"]}"""))
        assertEquals(listOf("house", "techno"), api.genres())
        assertEquals("/genres", server.takeRequest().url.encodedPath)

        server.enqueue(jsonResponse(200, """{"album":"Al","year":1999}"""))
        assertEquals(1999, api.metadata("Song", "Band", listOf("https://youtu.be/dQw4w9WgXcQ"), "", "").year)
        val metadata = server.takeRequest()
        assertEquals("/metadata", metadata.url.encodedPath)
        assertEquals(fixtureJson("ios_contract.json")["requests"]!!.jsonObject["metadata"], Json.parseToJsonElement(metadata.body!!.utf8()))
    }

    @Test
    fun fileRequestsCarryTheRangeOnlyWhenResuming() = runBlocking {
        server.enqueue(bytesResponse(200, ByteArray(4)))
        api.file("abc").use { assertEquals(200, it.response.code) }
        val whole = server.takeRequest()
        assertEquals("/files/abc", whole.url.encodedPath)
        assertNull(whole.headers["Range"])
        assertEquals("Bearer tok", whole.headers["Authorization"])

        server.enqueue(bytesResponse(206, ByteArray(4), "Content-Range" to "bytes 10-13/14"))
        api.file("abc", from = 10, validator = "\"v1\"").use { assertEquals(206, it.response.code) }
        val part = server.takeRequest()
        assertEquals("bytes=10-", part.headers["Range"])
        assertEquals("\"v1\"", part.headers["If-Range"])

        server.enqueue(jsonResponse(404, """{"detail":"not downloaded"}"""))
        assertEquals(404, failing<ApiError.Http> { api.file("abc") }.status)
    }

    @Test
    fun theBearerInterceptorOnlyServesTheServerHost() {
        val other = MockWebServer()
        other.start()
        try {
            val client = testHttp().newBuilder().addInterceptor(BearerInterceptor(server.url("/").toString()) { "secret" }).build()
            server.enqueue(bytesResponse(200, ByteArray(1)))
            other.enqueue(bytesResponse(200, ByteArray(1)))
            client.newCall(Request.Builder().url(server.url("/covers/abc?v=1")).build()).execute().close()
            client.newCall(Request.Builder().url(other.url("/img.jpg")).build()).execute().close()
            val ours = server.takeRequest()
            assertEquals("Bearer secret", ours.headers["Authorization"])
            assertFalse(ours.url.toString().contains("secret"))
            assertNull(other.takeRequest().headers["Authorization"])

            val signedOut = testHttp().newBuilder().addInterceptor(BearerInterceptor(server.url("/").toString()) { null }).build()
            server.enqueue(bytesResponse(200, ByteArray(1)))
            signedOut.newCall(Request.Builder().url(server.url("/covers/abc")).build()).execute().close()
            assertNull(server.takeRequest().headers["Authorization"])
        } finally {
            other.close()
        }
    }
}
