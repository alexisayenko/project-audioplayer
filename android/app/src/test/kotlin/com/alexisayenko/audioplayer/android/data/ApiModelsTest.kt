package com.alexisayenko.audioplayer.android.data

import com.alexisayenko.audioplayer.android.data.api.ApiError
import com.alexisayenko.audioplayer.android.data.api.ApiJson
import com.alexisayenko.audioplayer.android.data.api.CatalogResponse
import com.alexisayenko.audioplayer.android.data.api.CoverUrl
import com.alexisayenko.audioplayer.android.data.api.MetadataResult
import com.alexisayenko.audioplayer.android.data.api.MetadataService
import com.alexisayenko.audioplayer.android.data.api.MetadataServices
import com.alexisayenko.audioplayer.android.data.api.MetadataSuggest
import com.alexisayenko.audioplayer.android.data.api.Payloads
import com.alexisayenko.audioplayer.android.data.api.ServerSong
import com.alexisayenko.audioplayer.android.data.api.ServerUsage
import com.alexisayenko.audioplayer.android.data.api.SongStatus
import com.alexisayenko.audioplayer.android.fixture
import com.alexisayenko.audioplayer.android.fixtureJson
import com.alexisayenko.audioplayer.android.model.Preview
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.model.SongSource
import com.alexisayenko.audioplayer.android.model.SongVersion
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalSerializationApi::class)
class ApiModelsTest {
    private val contract = fixtureJson("ios_contract.json")
    private val structs = contract["structs"]!!.jsonObject

    /** The Kotlin model has exactly the keys of the Swift one, optional where Swift is optional. */
    private fun assertMatches(struct: String, descriptor: SerialDescriptor, requiredWithDefault: Set<String> = emptySet()) {
        val swift = structs[struct]!!.jsonObject
        assertEquals("$struct keys", swift.keys, descriptor.elementNames.toSet())
        for ((key, type) in swift) {
            val optional = type.jsonPrimitive.content.endsWith("?")
            val index = descriptor.getElementIndex(key)
            if (key in requiredWithDefault) continue
            assertEquals("$struct.$key optional", optional, descriptor.isElementOptional(index))
        }
    }

    @Test
    fun modelsHaveTheKeysOfTheSwiftContract() {
        assertMatches("ServerSong", ServerSong.serializer().descriptor)
        assertMatches("Preview", Preview.serializer().descriptor)
        assertMatches("SongStatus", SongStatus.serializer().descriptor)
        assertMatches("SongSource", SongSource.serializer().descriptor)
        assertMatches("SongVersion", SongVersion.serializer().descriptor)
        assertMatches("Track", Song.serializer().descriptor, requiredWithDefault = setOf("artist"))
        assertMatches("Suggest", MetadataSuggest.serializer().descriptor)
        assertMatches("Service", MetadataService.serializer().descriptor)
        assertMatches("Services", MetadataServices.serializer().descriptor)
    }

    @Test
    fun requestPayloadsMatchTheIosOnes() {
        val requests = contract["requests"]!!.jsonObject
        val song = Song(id = "dQw4w9WgXcQ", title = "Song", artist = "Band", sourceURL = "https://youtu.be/dQw4w9WgXcQ")
        assertEquals(requests["add"], Payloads.add(song.sourceURL!!, Payloads.addMetadata(song), emptyList(), audio = null))
        assertEquals(requests["edit"], Payloads.edit(song))
        assertEquals(requests["metadata"], Payloads.metadata("Song", "Band", listOf("https://youtu.be/dQw4w9WgXcQ"), "", ""))
        assertEquals("true", Payloads.add("u", Payloads.addMetadata(song), emptyList())["audio"].toString())
    }

    @Test
    fun editSendsOnlyWhatChangedPlusTitleLinksAndTags() {
        val base = Song(id = "a", title = "T", artist = "A", album = "Al", remixer = "R", year = 1999, tags = listOf("x"))
        val same = Payloads.edit(base, base)
        assertEquals(setOf("title", "wikipedia_song", "wikipedia_artist", "musicbrainz_url", "tags"), same.keys)
        val changed = Payloads.edit(base.copy(artist = "B", remixer = null, year = null, wikipediaSong = " https://w "), base)
        assertEquals("\"B\"", changed["artist"].toString())
        assertEquals("null", changed["remixer"].toString())
        assertEquals("null", changed["year"].toString())
        assertEquals("\"https://w\"", changed["wikipedia_song"].toString())
        assertFalse("album" in changed)
    }

    @Test
    fun serverSongBecomesASongExactlyAsOnIos() {
        val text = """{"id":"abc","title":"T","artist":null,"album":"Al","remixer":"R","year":1999,"duration":12.5,"cover":"abc.jpg","cover_v":"7",
            "tags":["genre:house"],"bpm":128.0,"source_url":"https://youtu.be/abc","wikipedia_song":"ws","wikipedia_artist":"wa","musicbrainz_url":"mb",
            "added_at":"2026-01-01T10:00:00Z","audio_state":"server","sources":[{"source":"youtube","id":"abc","url":"https://youtu.be/abc"}],
            "version":{"type":"remix","name":"R","artists":["X"],"releaseYear":2001,"originalArtists":["Y"]},"mainArtists":["M"],"featuredArtists":["F"],
            "withArtists":["W"],"releaseYear":1998,"albums":["Al"],"genres":["House"],"remix_year":2001,"rawTitle":"raw","wikipedia_album":"wal",
            "discogs_url":"dg","unknown_future_key":{"a":1}}"""
        val song = ApiJson.decodeFromString<ServerSong>(text).toSong()
        assertEquals("", song.artist)
        assertEquals("/covers/abc?v=7", song.thumbnail)
        assertEquals(1767261600000L, song.addedAt)
        assertEquals(true, song.onServer)
        assertNull(song.localOnly)
        assertEquals("https://youtu.be/abc", song.sourceURL)
        assertEquals("ws", song.wikipediaSong)
        assertEquals("wa", song.wikipediaArtist)
        assertEquals("mb", song.musicbrainzURL)
        assertEquals(2001, song.remixYear)
        assertEquals("wal", song.wikipediaAlbum)
        assertEquals("dg", song.discogsURL)
        assertEquals(SongVersion("remix", "R", listOf("X"), 2001, listOf("Y")), song.version)
        assertEquals(listOf(SongSource("youtube", "abc", "https://youtu.be/abc")), song.sources)
        assertEquals(listOf("House"), song.genres)
    }

    @Test
    fun coverAndAudioStateEdgeCases() {
        val bare = ApiJson.decodeFromString<ServerSong>("""{"id":"x","title":"T"}""").toSong()
        assertNull(bare.thumbnail)
        assertNull(bare.onServer)
        assertNull(bare.addedAt)
        val none = ApiJson.decodeFromString<ServerSong>("""{"id":"x","title":"T","cover":"c","audio_state":"none","added_at":"yesterday"}""").toSong()
        assertEquals("/covers/x", none.thumbnail)
        assertEquals(false, none.onServer)
        assertNull(none.addedAt)
    }

    @Test
    fun everySongOfTheLegacySampleDecodes() {
        val songs = fixtureJson("legacy_library_sample.json")["songs"]!!.jsonArray
        assertTrue(songs.size > 5)
        val catalog = CatalogResponse.decode(JsonObject(mapOf("ids" to JsonArray(songs.map { it.jsonObject["id"]!! }), "songs" to songs)).toString())
        assertEquals(songs.size, catalog.ids.size)
        assertEquals("only the record whose year is a boolean is skipped", listOf("aaaaaaaaac5"), catalog.skipped)
        assertEquals("a year stored as text is still read", 1999, catalog.songs.first { it.id == "aaaaaaaaac4" }.year)
        assertEquals(songs.size - 1, catalog.songs.size)
        assertEquals("", catalog.songs.first { it.id == "aaaaaaaaab1" }.toSong().artist)
        assertEquals("Haddaway", catalog.songs.first { it.id == "aaaaaaaaaa2" }.toSong().artist)
    }

    @Test
    fun aCatalogSongThatFailsToDecodeIsSkippedNotFatal() {
        val catalog = CatalogResponse.decode("""{"revision":"r","ids":["a","b","c"],"songs":[{"id":"a","title":"A"},{"id":"b","title":null},{"title":"no id"},7,{"id":"c","title":"C","year":"x"}]}""")
        assertEquals(listOf("a"), catalog.songs.map { it.id })
        assertEquals(listOf("a", "b", "c"), catalog.ids)
        assertEquals(listOf("b", "?", "?", "c"), catalog.skipped)
    }

    @Test
    fun aCatalogWithoutListsIsEmptyAndABrokenOneThrows() {
        val empty = CatalogResponse.decode("{}")
        assertTrue(empty.ids.isEmpty() && empty.songs.isEmpty())
        assertTrue(runCatching { CatalogResponse.decode("[]") }.isFailure)
        assertTrue(runCatching { CatalogResponse.decode("""{"songs":{}}""") }.isFailure)
    }

    @Test
    fun songStatusWordsAreTheIosOnes() {
        fun status(body: String) = ApiJson.decodeFromString<SongStatus>(body)
        assertEquals("This link is only a preview, so there is no full song to download.", status("""{"status":"error","error_code":"preview_only"}""").failureMessage)
        assertEquals("This link can't be downloaded.", status("""{"status":"error","code":"unsupported"}""").failureMessage)
        assertEquals("Your storage is full. Delete some songs to free space.", status("""{"status":"error","code":"library_full_bytes"}""").failureMessage)
        assertEquals("Your library is full. Delete some songs to add more.", status("""{"status":"error","code":"library_full_songs"}""").failureMessage)
        assertEquals("The server is out of storage right now. Try again later.", status("""{"status":"error","code":"server_full"}""").failureMessage)
        assertEquals("Hourly limit reached. Try again later.", status("""{"status":"error","code":"hourly_limit"}""").failureMessage)
        assertEquals("The download failed. Try again.", status("""{"status":"error","error":""}""").failureMessage)
        assertEquals("The download failed: boom", status("""{"status":"error","error":"boom","code":"other"}""").failureMessage)
        assertEquals("preview_only", status("""{"status":"error","error_code":"preview_only","code":"x"}""").failureCode)
        val queued = status("""{"id":"a","status":"queued","progress":0.0,"error":null,"state":"queued","percent":0,"speed":null,"eta":null,"error_code":null}""")
        assertTrue(queued.isQueued && queued.isActive)
        assertTrue(status("""{"status":"downloading","state":"converting"}""").isConverting)
        assertTrue(status("""{"status":"done","progress":1.0}""").isDone)
    }

    @Test
    fun usageDecodesWithOwnerNulls() {
        val owner = ApiJson.decodeFromString<ServerUsage>("""{"songs":12,"max_songs":null,"bytes":3000,"max_bytes":null,"adds_last_hour":2,"max_adds":null}""")
        assertEquals(Usage(12, null, 3000, null), owner.toUsage())
        assertNull(owner.fetchesLeft)
        val user = ApiJson.decodeFromString<ServerUsage>("""{"songs":1,"max_songs":500,"bytes":4500,"max_bytes":5000,"adds_last_hour":25,"max_adds":20}""")
        assertEquals(0, user.fetchesLeft)
        assertEquals(500L, user.bytesLeft)
        assertEquals(Usage(1, 500, 4500, 5000), user.toUsage())
    }

    @Test
    fun metadataReadsEachFieldOnItsOwn() {
        val result = MetadataResult.decode("""{"album":"Al","year":"not a year","tags":["genre:house"],"services":{"wikipedia":{"found":true,"url":"https://w"}},"suggest":{"artist":"A"}}""")
        assertEquals("Al", result.album)
        assertNull(result.year)
        assertEquals(listOf("genre:house"), result.tags)
        assertEquals(true, result.services?.wikipedia?.found)
        assertEquals("A", result.suggest?.artist)
    }

    @Test
    fun previewDecodesTheServerShape() {
        val preview = ApiJson.decodeFromString<Preview>("""{"id":"abc","source":"youtube","source_url":"https://youtu.be/abc","title":"T","in_library":false,"extra":1}""")
        assertEquals("https://youtu.be/abc", preview.source_url)
        assertEquals(false, preview.in_library)
    }

    @Test
    fun errorMappingFollowsTheServerBodies() {
        fun body(text: String) = Json.parseToJsonElement(text)
        val unauthorized = ApiError.from(401, body("""{"detail":"bad token"}"""), "")
        assertTrue(unauthorized is ApiError.Http && unauthorized.isUnauthorized)
        assertEquals("bad token", (unauthorized as ApiError.Http).detail)
        assertEquals("Not signed in. Sign in in Settings", unauthorized.message)

        val limit = ApiError.from(429, body("""{"error":"hourly_limit","detail":"You can add 20 songs per hour. Try again in 37 min.","retry_after_minutes":37}"""), "", 2220)
        assertTrue(limit.isHourlyLimit)
        assertEquals(37, limit.waitMinutes)
        assertEquals("You can add 20 songs per hour. Try again in 37 min.", limit.message)
        assertFalse(limit.isTransient)
        assertEquals(12, ApiError.from(429, body("""{"error":"hourly_limit","detail":"Slow down."}"""), "", 700).waitMinutes)
        assertEquals(5, ApiError.from(429, body("""{"error":"hourly_limit","detail":"Try again in 5 min."}"""), "").waitMinutes)
        assertEquals(1, ApiError.from(429, body("""{"error":"hourly_limit","detail":"Later."}"""), "").waitMinutes)
        assertEquals(3, ApiError.from(429, body("""{"detail":"Too many. Try again in 3 min."}"""), "").waitMinutes)

        for (code in listOf("library_full_songs", "library_full_bytes")) {
            val full = ApiError.from(403, body("""{"error":"$code","detail":"Your library is full (500 songs). Delete some songs to add more."}"""), "")
            assertTrue(full.isLibraryFull)
            assertFalse(full.isTransient)
            assertEquals(code, (full as ApiError.Refused).code)
        }
        val serverFull = ApiError.from(503, body("""{"error":"server_full","detail":"The server's storage is full. Try again later."}"""), "")
        assertTrue(serverFull.isServerFull)
        assertFalse(serverFull.isTransient)
        assertTrue(ApiError.from(503, body("""{"detail":"starting","error":"service_unavailable"}"""), "").isTransient)
        assertTrue(ApiError.from(502, null, "Bad Gateway").isTransient)

        assertTrue(ApiError.from(403, body("""{"error":"signup_closed","detail":"x"}"""), "") is ApiError.Forbidden)
        val validation = ApiError.from(422, body("""{"detail":[{"msg":"title must not be empty","loc":["body"]},{"msg":"bad year"}],"error":"unprocessable"}"""), "")
        assertEquals("title must not be empty; bad year", validation.message)
        assertEquals("title must not be empty", ApiError.from(422, body("""{"detail":"title must not be empty","error":"unprocessable"}"""), "").message)
        assertEquals("conflict", ApiError.from(409, body("""{"error":"conflict"}"""), "").message)
        assertEquals("Server error 500", ApiError.from(500, null, "").message)
        assertEquals("oops", ApiError.from(500, null, "oops").message)
        assertEquals(37, ApiError.retryMinutes("You can add 20 songs per hour. Try again in 37 min."))
        assertEquals(1, ApiError.retryMinutes("Try again later"))
    }

    @Test
    fun coverReferencesNeverCarryAToken() {
        assertEquals("https://electrophone.cc/covers/abc?v=3", CoverUrl.resolve("/covers/abc?v=3", "https://electrophone.cc"))
        assertEquals("https://electrophone.cc/covers/abc", CoverUrl.resolve("/covers/abc?token=secret", "https://electrophone.cc/"))
        assertEquals("https://i.ytimg.com/vi/abc/hq.jpg", CoverUrl.resolve("https://i.ytimg.com/vi/abc/hq.jpg", "https://electrophone.cc"))
        assertNull(CoverUrl.resolve(null, "https://electrophone.cc"))
        assertNull(CoverUrl.resolve("", "https://electrophone.cc"))
        assertNull(CoverUrl.resolve("/covers/abc", "not a url"))
        assertEquals("/covers/abc", CoverUrl.scrubbed("/covers/abc?v=2&token=secret"))
        assertEquals("/covers/abc", CoverUrl.scrubbed("https://electrophone.cc/covers/abc?token=secret"))
        assertEquals("https://img.example/a.jpg?w=2", CoverUrl.scrubbed("https://img.example/a.jpg?token=s&w=2"))
        assertEquals("https://img.example/a.jpg", CoverUrl.scrubbed("https://img.example/a.jpg?token=s"))
        assertEquals("/covers/abc?v=2", CoverUrl.scrubbed("/covers/abc?v=2"))
        assertNull(CoverUrl.scrubbed(null))
        assertFalse(fixture("ios_contract.json").isEmpty())
    }
}
