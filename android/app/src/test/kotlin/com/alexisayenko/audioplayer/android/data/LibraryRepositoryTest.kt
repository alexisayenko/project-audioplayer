package com.alexisayenko.audioplayer.android.data

import com.alexisayenko.audioplayer.android.FakeAccount
import com.alexisayenko.audioplayer.android.FakeQueue
import com.alexisayenko.audioplayer.android.FakeSettings
import com.alexisayenko.audioplayer.android.apiFor
import com.alexisayenko.audioplayer.android.data.api.CatalogResponse
import com.alexisayenko.audioplayer.android.data.api.ServerSong
import com.alexisayenko.audioplayer.android.data.store.AudioFiles
import com.alexisayenko.audioplayer.android.data.store.LibraryIndex
import com.alexisayenko.audioplayer.android.jsonResponse
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.tempDir
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The rules of `LibraryStore.merge` and of the catalog sync in `ServerLink` (the Swift code has no tests of its own for them). */
class LibraryRepositoryTest {
    private lateinit var dir: File
    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope
    private val account = FakeAccount()
    private val settings = FakeSettings()
    private val queue = FakeQueue()

    @Before
    fun setUp() {
        dir = tempDir("library-repo")
        server = MockWebServer()
        server.start()
        scope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
        dir.deleteRecursively()
    }

    private fun index() = LibraryIndex(File(dir, "library.json"), File(dir, "phone-index.json"))

    private fun repository() = LibraryRepository(
        index(), AudioFiles(File(dir, "audio")), apiFor(server), account, settings, queue, scope,
        io = Dispatchers.Unconfined, now = { 1_800_000_000_000L },
    )

    private fun record(id: String, title: String = id.uppercase(), state: String? = "server", cover: String? = null, coverV: String? = null, addedAt: String? = null) =
        ServerSong(id = id, title = title, artist = "Artist", audio_state = state, cover = cover, cover_v = coverV, added_at = addedAt)

    private fun catalog(vararg songs: ServerSong, ids: List<String> = songs.map { it.id }) = CatalogResponse(ids, songs.toList())

    private fun audioFile(name: String) = File(dir, "audio").apply { mkdirs() }.resolve(name).also { it.writeText("audio") }

    @Test
    fun theFirstSyncIsABaselineAndLaterOnesReportWhatAppeared() {
        val repo = repository()
        val first = repo.merge(catalog(record("a"), record("b")), "\"1\"")
        assertTrue(first.appeared.isEmpty())
        assertEquals(listOf("a", "b"), repo.songs.value.map { it.id })
        assertEquals("\"1\"", repo.etag)
        val second = repo.merge(catalog(record("c"), record("a"), record("b"), record("d", state = "none")), "\"2\"")
        assertEquals(listOf("c"), second.appeared.map { it.id })
        assertEquals(listOf("c", "a", "b", "d"), repo.songs.value.map { it.id })
        assertEquals(AudioState.Server, repo.audioState(repo.songs.value[0]))
        assertEquals(AudioState.None, repo.audioState(repo.songs.value[3]))
        val third = repo.merge(catalog(record("c"), record("a"), record("b"), record("d")), null)
        assertEquals(listOf("d"), third.reachedServer.map { it.id })
        assertEquals("synced", repo.etag)
    }

    @Test
    fun aSongTheServerForgotStaysOnlyWhileItsAudioIsOnThePhone() {
        audioFile("a.m4a")
        index().save("\"1\"", listOf(Song("a", "A", "Artist", onServer = true), Song("b", "B", "Artist", onServer = true)), emptyMap(), setOf("a"))
        val repo = repository()
        assertEquals(setOf("a"), repo.phoneIds.value)
        repo.merge(catalog(record("c")), "\"2\"")
        val kept = repo.songs.value.first { it.id == "a" }
        assertEquals(listOf("c", "a"), repo.songs.value.map { it.id })
        assertEquals(true, kept.localOnly)
        assertEquals(false, kept.onServer)
        assertEquals(AudioState.Phone, repo.audioState(kept))
        assertEquals(setOf("a"), repo.phoneIds.value)
        assertEquals(listOf("c", "a"), index().load().songs.map { it.id })
    }

    @Test
    fun aSongOnlyNamedInTheIdsIsKeptAsItWas() {
        val repo = repository()
        repo.merge(catalog(record("a"), record("b")), "\"1\"")
        repo.merge(catalog(record("a", title = "New"), ids = listOf("a", "b")), "\"2\"")
        assertEquals(listOf("New", "B"), repo.songs.value.map { it.title })
    }

    @Test
    fun mergeKeepsTheAddedDateAndTheCoverAndReportsCoverChanges() {
        index().save("\"1\"", listOf(Song("a", "A", "Artist", thumbnail = "/covers/a?v=1", addedAt = 1_700_000_000_123L), Song("b", "B", "Artist", thumbnail = "/covers/b")), emptyMap(), emptySet())
        val repo = repository()
        val result = repo.merge(catalog(record("a", cover = "a.jpg", coverV = "2"), record("b"), record("a", title = "duplicate")), "\"2\"")
        val a = repo.songs.value.first { it.id == "a" }
        assertEquals(1_700_000_000_123L, a.addedAt)
        assertEquals("/covers/a?v=2", a.thumbnail)
        assertEquals("/covers/b", repo.songs.value.first { it.id == "b" }.thumbnail)
        assertEquals(listOf("a"), result.coverChanges)
        assertEquals(2, repo.songs.value.size)
        assertEquals("A", a.title)
    }

    @Test
    fun mergeRenamesThePhoneFileWhenTheSongWasRenamed() {
        audioFile("a.m4a")
        index().save(null, listOf(Song("a", "", "")), emptyMap(), setOf("a"))
        val repo = repository()
        repo.merge(catalog(record("a", title = "Real Title")), "\"1\"")
        assertEquals("Artist - Real Title.m4a", repo.fileFor("a")!!.name)
        assertTrue(repo.fileFor("a")!!.exists())
        assertEquals(mapOf("a" to "Artist - Real Title.m4a"), index().load().files)
    }

    @Test
    fun tokensAreScrubbedFromStoredCoversAtLoad() {
        index().save(null, listOf(Song("a", "A", "Artist", thumbnail = "/covers/a?token=secret")), emptyMap(), emptySet())
        val repo = repository()
        assertEquals("/covers/a", repo.songs.value.single().thumbnail)
        assertFalse(File(dir, "library.json").readText().contains("secret"))
    }

    @Test
    fun signedOutTheListHoldsOnlyThePhoneSongsAndNothingIsRead() = runBlocking {
        audioFile("a.m4a")
        index().save("\"1\"", listOf(Song("a", "A", "Artist"), Song("b", "B", "Artist")), emptyMap(), setOf("a"))
        account.signOut()
        val repo = repository()
        assertEquals(listOf("a"), repo.songs.value.map { it.id })
        repo.syncCatalog()
        assertNull(repo.usage())
        assertEquals(0, server.requestCount)
        assertEquals(SyncStatus(), repo.status.value)
        assertTrue(repo.fileFor("a")!!.exists())
        assertNull(repo.fileFor("b"))
        assertEquals("signed out, the queued downloads are cancelled", 1, queue.cancelledAll)
    }

    @Test
    fun syncSendsTheEtagMergesAndQueuesNewSongsWhenAutomaticDownloadIsOn() = runBlocking {
        val repo = repository()
        server.enqueue(jsonResponse(200, """{"ids":["a"],"songs":[{"id":"a","title":"A","audio_state":"server"}]}""", "ETag" to "\"1\""))
        repo.syncCatalog()
        assertNull(server.takeRequest().headers["If-None-Match"])
        assertTrue(queue.enqueued.isEmpty())
        assertTrue(repo.status.value.synced)
        assertEquals(true, repo.status.value.reachable)

        server.enqueue(jsonResponse(304, ""))
        repo.syncCatalog()
        assertEquals("\"1\"", server.takeRequest().headers["If-None-Match"])
        assertEquals(listOf("a"), repo.songs.value.map { it.id })

        server.enqueue(jsonResponse(200, """{"ids":["b","a","c"],"songs":[{"id":"b","title":"B","audio_state":"server"},{"id":"a","title":"A","audio_state":"server"},{"id":"c","title":"C","audio_state":"none"}]}""", "ETag" to "\"2\""))
        repo.syncCatalog()
        assertEquals(listOf("b"), queue.enqueued)
        assertEquals("\"2\"", repo.etag)
        assertFalse(repo.status.value.syncing)

        settings.setDownloadNewAutomatically(false)
        server.enqueue(jsonResponse(200, """{"ids":["d","b","a","c"],"songs":[{"id":"d","title":"D","audio_state":"server"},{"id":"b","title":"B","audio_state":"server"},{"id":"a","title":"A","audio_state":"server"},{"id":"c","title":"C","audio_state":"none"}]}""", "ETag" to "\"3\""))
        repo.syncCatalog()
        assertEquals(listOf("b"), queue.enqueued)
    }

    @Test
    fun aFailedSyncKeepsTheCacheAndSaysWhy() = runBlocking {
        index().save("\"1\"", listOf(Song("a", "A", "Artist")), emptyMap(), emptySet())
        val repo = repository()
        server.enqueue(jsonResponse(401, """{"detail":"bad token"}"""))
        repo.syncCatalog()
        assertTrue(repo.status.value.unauthorized)
        assertEquals("The server didn't accept your sign-in (401). Sign out and sign in again.", repo.status.value.message)
        assertEquals(listOf("a"), repo.songs.value.map { it.id })
        server.enqueue(jsonResponse(500, """{"detail":"boom"}"""))
        repo.syncCatalog()
        assertEquals("The server answered with error 500: boom", repo.status.value.message)
        assertFalse(repo.status.value.unauthorized)
        server.enqueue(jsonResponse(304, ""))
        repo.syncCatalog()
        assertNull(repo.status.value.message)
        assertTrue(repo.status.value.synced)
    }

    @Test
    fun anArrivedFileIsListedAndWrittenToThePhoneIndex() = runBlocking {
        val repo = repository()
        repo.merge(catalog(record("a", addedAt = "2026-01-01T10:00:00Z")), "\"1\"")
        val song = repo.song("a")!!
        val file = repo.reserve(song)
        assertEquals("Artist - A.m4a", file.name)
        assertEquals(mapOf("a" to "Artist - A.m4a"), index().load().files)
        assertFalse(repo.isOnPhone("a"))
        file.writeText("audio")
        repo.arrived(song)
        assertEquals(setOf("a"), repo.phoneIds.value)
        assertEquals(file, repo.fileFor("a"))
        assertEquals(5L, repo.phoneBytes())
        val loaded = index().load()
        assertEquals(setOf("a"), loaded.phoneIds)
        assertEquals(1767261600000L, loaded.songs.single().addedAt)
        assertTrue(repository().isOnPhone("a"))
    }

    @Test
    fun removingAudioNeverTouchesTheServer() = runBlocking {
        audioFile("a.m4a")
        audioFile("b.m4a")
        audioFile("gone.m4a")
        index().save("\"1\"", listOf(Song("a", "", ""), Song("b", "", ""), Song("gone", "", "", localOnly = true, onServer = false)), emptyMap(), setOf("a", "b", "gone"))
        val repo = repository()
        repo.removeAudio("a")
        assertFalse(File(dir, "audio/a.m4a").exists())
        assertEquals(setOf("b", "gone"), repo.phoneIds.value)
        assertEquals(3, repo.songs.value.size)
        assertEquals(1, repo.removeAllAudio())
        assertEquals(setOf("gone"), repo.phoneIds.value)
        assertTrue(File(dir, "audio/gone.m4a").exists())
        repo.removeAudio("gone")
        assertEquals(listOf("a", "b"), repo.songs.value.map { it.id })
        assertEquals(0, server.requestCount)
        assertEquals(emptySet<String>(), index().load().phoneIds)
    }

    @Test
    fun deleteAsksTheServerThenForgetsTheSong() = runBlocking {
        audioFile("a.m4a")
        index().save("\"1\"", listOf(Song("a", "", ""), Song("b", "", "")), emptyMap(), setOf("a"))
        val repo = repository()
        server.enqueue(jsonResponse(500, """{"detail":"boom"}"""))
        assertEquals(Outcome.Failed("boom"), repo.delete("a"))
        assertEquals(2, repo.songs.value.size)
        server.enqueue(jsonResponse(204, ""))
        assertEquals(Outcome.Ok(Unit), repo.delete("a"))
        assertEquals(listOf("b"), repo.songs.value.map { it.id })
        assertFalse(File(dir, "audio/a.m4a").exists())
        assertEquals(listOf("a"), queue.cancelled)
    }

    @Test
    fun addSavesWithTheIosPayloadListsTheSongAndQueuesItsDownload() = runBlocking {
        val repo = repository()
        repo.merge(catalog(record("a")), "\"1\"")
        val song = Song(id = "new", title = "Song", artist = "Band", sourceURL = "https://youtu.be/new", thumbnail = "/covers/new")
        assertEquals(Outcome.Failed("The song has no link."), repo.add(song.copy(sourceURL = null), download = true))
        server.enqueue(jsonResponse(403, """{"error":"library_full_songs","detail":"Your library is full (500 songs). Delete some songs to add more."}"""))
        assertEquals(Outcome.Failed("Your library is full (500 songs). Delete some songs to add more."), repo.add(song, download = true))
        server.takeRequest()
        server.enqueue(jsonResponse(202, """{"id":"new","status":"downloading"}"""))
        val added = repo.add(song, download = true) as Outcome.Ok
        assertEquals(false, added.value.onServer)
        assertEquals("/songs", server.takeRequest().url.encodedPath)
        assertEquals(listOf("new", "a"), repo.songs.value.map { it.id })
        assertEquals(listOf("new"), queue.enqueued)
        assertEquals(AudioState.None, repo.audioState(added.value))
        repo.merge(catalog(record("a")), "\"2\"")
        assertEquals("a song the server is still fetching is not dropped by a sync", listOf("a", "new"), repo.songs.value.map { it.id })
    }

    @Test
    fun updatePatchesOnlyTheChangesAndKeepsThePhoneState() = runBlocking {
        audioFile("a.m4a")
        index().save("\"1\"", listOf(Song("a", "Old", "Artist", thumbnail = "/covers/a", addedAt = 1_700_000_000_005L, onServer = true)), emptyMap(), setOf("a"))
        val repo = repository()
        server.enqueue(jsonResponse(200, """{"id":"a","title":"New","artist":"Artist","year":1999}"""))
        val updated = repo.update(repo.song("a")!!.copy(title = "New", year = 1999)) as Outcome.Ok
        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        assertEquals("""{"title":"New","year":1999,"wikipedia_song":null,"wikipedia_artist":null,"musicbrainz_url":null,"tags":[]}""", request.body!!.utf8())
        assertEquals("/covers/a", updated.value.thumbnail)
        assertEquals(1_700_000_000_005L, updated.value.addedAt)
        assertEquals(true, updated.value.onServer)
        assertEquals("Artist - New.m4a", repo.fileFor("a")!!.name)
        server.enqueue(jsonResponse(422, """{"detail":"title must not be empty"}"""))
        assertEquals(Outcome.Failed("title must not be empty"), repo.update(updated.value.copy(title = "")))
    }

    @Test
    fun downloadAllMissingQueuesServerSongsThatAreNotOnThePhone() {
        audioFile("a.m4a")
        index().save("\"1\"", listOf(Song("a", "", ""), Song("b", "", "", onServer = true), Song("c", "", "", onServer = false), Song("d", "", ""), Song("e", "", "")), emptyMap(), setOf("a"))
        queue.transfers.value = mapOf("d" to Transfer.Waiting, "e" to Transfer.Failed("x"))
        val repo = repository()
        assertEquals(2, repo.downloadAllMissing())
        assertEquals(listOf("b", "e"), queue.enqueued)
        repo.download(repo.song("a")!!)
        assertEquals(listOf("b", "e"), queue.enqueued)
        repo.cancelDownload("b")
        assertEquals(listOf("b"), queue.cancelled)
    }
}
