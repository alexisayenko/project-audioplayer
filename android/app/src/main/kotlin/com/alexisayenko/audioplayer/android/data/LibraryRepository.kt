package com.alexisayenko.audioplayer.android.data

import com.alexisayenko.audioplayer.android.auth.Account
import com.alexisayenko.audioplayer.android.data.api.ApiClient
import com.alexisayenko.audioplayer.android.data.api.ApiError
import com.alexisayenko.audioplayer.android.data.api.CatalogResponse
import com.alexisayenko.audioplayer.android.data.api.CoverUrl
import com.alexisayenko.audioplayer.android.data.api.Payloads
import com.alexisayenko.audioplayer.android.data.store.AudioFiles
import com.alexisayenko.audioplayer.android.data.store.LibraryIndex
import com.alexisayenko.audioplayer.android.download.DownloadQueue
import com.alexisayenko.audioplayer.android.download.DownloadTarget
import com.alexisayenko.audioplayer.android.model.Preview
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What [LibraryRepository.merge] found new in a catalog. */
data class MergeResult(
    /** Songs that appeared since the last sync with audio on the server and none on the phone (empty on the first sync, which is only a baseline). */
    val appeared: List<Song> = emptyList(),
    /** Songs already listed whose audio reached the server since the last sync and is not on the phone. */
    val reachedServer: List<Song> = emptyList(),
    /** Songs whose cover reference changed; the image cache keys by URL, so a new `?v=` loads the new image by itself. */
    val coverChanges: List<String> = emptyList(),
)

/**
 * The library on this phone: every song the server lists (cached for offline use) plus the songs whose audio is stored here.
 * A port of `ios/Sources/LibraryStore.swift` and of the catalog and sync parts of `ios/Sources/ServerLink.swift`.
 * A song is "on the phone" when its file exists in `filesDir/audio` (named by [AudioFiles]); that is never written to disk as
 * a flag, only the id to file name map is, in `library.json` and `phone-index.json` ([LibraryIndex]).
 *
 * The index is read in the constructor, so [songs] and [fileFor] are valid as soon as the object exists and playback of the
 * songs on the phone never waits for the network or for sign-in (AND-002). Construct it off the main thread if the read
 * (one JSON file) is too slow for a cold start.
 *
 * @param scope a scope that lives as long as the app
 */
class LibraryRepository(
    private val index: LibraryIndex,
    private val audio: AudioFiles,
    private val api: ApiClient,
    private val account: Account,
    private val settings: AppSettings,
    private val downloads: DownloadQueue,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis,
) : Library, DownloadTarget {
    private val lock = Any()
    private var all: List<Song> = emptyList()
    private var phone: Set<String> = emptySet()

    /** Songs just saved with `POST /songs` that the catalog does not list until the server has their audio. */
    private val pendingAdds = HashSet<String>()

    /** ETag of the last catalog the server sent, for `If-None-Match`; null until a sync or after a recovery. */
    var etag: String? = null
        private set

    private val songsState = MutableStateFlow<List<Song>>(emptyList())
    private val phoneState = MutableStateFlow<Set<String>>(emptySet())
    private val statusState = MutableStateFlow(SyncStatus())
    private val noticeFlow = MutableSharedFlow<String>(extraBufferCapacity = 8)

    override val songs: StateFlow<List<Song>> get() = songsState
    override val phoneIds: StateFlow<Set<String>> get() = phoneState
    override val transfers: StateFlow<Map<String, Transfer>> get() = downloads.transfers
    override val status: StateFlow<SyncStatus> get() = statusState

    /** One-time messages for the person (a failed save in the background), shown as a toast. */
    val notices: SharedFlow<String> get() = noticeFlow

    init {
        val loaded = index.load()
        all = loaded.songs
        audio.load(loaded.files)
        etag = loaded.etag
        var changed = loaded.recovered
        if (loaded.recovered) audio.adopt(all)
        all = all.map { song ->
            val clean = CoverUrl.scrubbed(song.thumbnail)
            if (clean != song.thumbnail) {
                changed = true
                song.copy(thumbnail = clean)
            } else {
                song
            }
        }
        phone = all.filter { audio.file(it.id).exists() }.mapTo(HashSet()) { it.id }
        if (changed || phone != loaded.phoneIds) save()
        publish()
        scope.launch {
            account.session.collect { session ->
                // Signed out nothing may talk to the server, so the queued downloads go too (`ServerLink.cancelBackgroundWork`).
                if (session == null) downloads.cancelAll()
                publish()
            }
        }
        scope.launch { api.reachability.state.collect { reachable -> statusState.update { it.copy(reachable = reachable) } } }
        scope.launch(io) { migrateFileNames() }
    }

    // region state

    private fun signedIn(): Boolean = account.session.value != null

    /** Signed out, the list holds only the songs on the phone (AND-002). */
    private fun publish() {
        val (list, ids) = synchronized(lock) { all to phone }
        phoneState.value = ids
        songsState.value = if (signedIn()) list else list.filter { it.id in ids }
    }

    private fun save() {
        synchronized(lock) {
            index.save(etag, all, audio.snapshot(all.mapTo(HashSet()) { it.id }), phone)
        }
    }

    /** Gives files still named `<id>.m4a` (and files whose song was renamed elsewhere) readable names. */
    private fun migrateFileNames() {
        val list = synchronized(lock) { all }
        if (!audio.syncAll(list)) return
        save()
        refreshPhone()
    }

    /** Re-reads which audio files exist, so a file that vanished stops counting as on the phone. */
    fun refreshPhone() {
        synchronized(lock) {
            phone = all.filter { audio.file(it.id).exists() }.mapTo(HashSet()) { it.id }
        }
        publish()
    }

    override fun audioState(song: Song): AudioState = when {
        song.id in phoneState.value -> AudioState.Phone
        song.onServer != false && song.localOnly != true -> AudioState.Server
        else -> AudioState.None
    }

    override fun fileFor(id: String): File? = if (id in phoneState.value) audio.file(id).takeIf { it.exists() } else null

    // endregion

    // region DownloadTarget

    override fun song(id: String): Song? = synchronized(lock) { all.firstOrNull { it.id == id } }

    override fun isOnPhone(id: String): Boolean = synchronized(lock) { id in phone } && audio.file(id).exists()

    /** Reserves the file name and writes it to the index at once, so a file that lands just before the process dies is still found. */
    override fun reserve(song: Song): File {
        val file = audio.reserve(song)
        save()
        return file
    }

    /** A song whose file has just arrived on the phone (`LibraryStore.add`). */
    override suspend fun arrived(song: Song) = withContext(io) {
        synchronized(lock) {
            val i = all.indexOfFirst { it.id == song.id }
            val listed = if (i >= 0) {
                val prev = all[i]
                val merged = song.copy(
                    addedAt = song.addedAt ?: prev.addedAt,
                    sources = song.sources ?: prev.sources,
                    localOnly = prev.localOnly,
                    thumbnail = song.thumbnail ?: prev.thumbnail,
                ).inheritDetail(prev).copy(onServer = prev.localOnly != true)
                all = all.toMutableList().also { it[i] = merged }
                merged
            } else {
                val fresh = song.copy(addedAt = song.addedAt ?: now(), onServer = true)
                all = listOf(fresh) + all
                fresh
            }
            audio.sync(listed)
            phone = phone + listed.id
            pendingAdds -= listed.id
            save()
        }
        publish()
    }

    // endregion

    // region catalog sync

    /**
     * Merges the server's catalog, keeping each song's phone state (`LibraryStore.merge`). Songs the server forgot are
     * dropped only when they have no audio here; otherwise they stay as local-only. A song that was just added or is being
     * downloaded stays listed although the catalog does not have it yet (the server lists it when its audio is in).
     */
    fun merge(catalog: CatalogResponse, newTag: String?): MergeResult {
        val result = synchronized(lock) {
            val hadCatalog = etag != null
            val old = HashMap<String, Song>()
            for (song in all) old.putIfAbsent(song.id, song)
            val waiting = downloads.transfers.value.filterValues { it !is Transfer.Failed }.keys
            val ids = catalog.ids.toSet() + pendingAdds + waiting
            val merged = ArrayList<Song>(catalog.songs.size)
            val seen = HashSet<String>()
            val appeared = ArrayList<Song>()
            val reached = ArrayList<Song>()
            val coverChanges = ArrayList<String>()
            for (record in catalog.songs) {
                if (!seen.add(record.id)) continue
                var song = record.toSong()
                val prev = old[record.id]
                if (prev != null) {
                    song = song.copy(addedAt = song.addedAt ?: prev.addedAt, thumbnail = song.thumbnail ?: prev.thumbnail)
                    if (song.thumbnail != prev.thumbnail) coverChanges += record.id
                    if (song.onServer == true && prev.onServer == false) reached += song
                } else if (hadCatalog && song.onServer == true) {
                    appeared += song
                }
                merged += song
            }
            for (prev in all) {
                if (prev.id in seen) continue
                when {
                    prev.id in ids -> merged += prev
                    prev.id in phone -> merged += prev.copy(localOnly = true, onServer = false)
                    else -> audio.forget(prev.id)
                }
            }
            all = merged
            val listed = merged.mapTo(HashSet()) { it.id }
            phone = phone.filterTo(HashSet()) { it in listed }
            for (song in merged) if (song.id in phone) audio.sync(song)
            etag = newTag ?: "synced"
            save()
            MergeResult(appeared.filter { it.id !in phone }, reached.filter { it.id !in phone }, coverChanges)
        }
        publish()
        return result
    }

    /**
     * Fetches the catalog with the stored ETag and merges it (AND-058); a 304 changes nothing. Signed out it does nothing and
     * reads nothing (AND-002). Failures are quiet: [status] says what went wrong and the cached catalog stays. With
     * "Download new songs automatically" on, the songs that newly have audio on the server are queued.
     */
    override suspend fun syncCatalog() = syncCatalog(auto = true)

    private suspend fun syncCatalog(auto: Boolean) {
        if (!signedIn()) return
        synchronized(lock) {
            if (statusState.value.syncing) return
            statusState.update { it.copy(syncing = true) }
        }
        try {
            val fetched = api.catalog(etag)
            if (fetched != null) {
                val result = withContext(io) { merge(fetched.catalog, fetched.etag) }
                if (auto && settings.downloadNewAutomatically.value) {
                    (result.appeared + result.reachedServer).forEach(downloads::enqueue)
                }
            }
            statusState.update { it.copy(syncing = false, synced = true, reachable = true, unauthorized = false, message = null) }
        } catch (e: CancellationException) {
            statusState.update { it.copy(syncing = false) }
            throw e
        } catch (e: Exception) {
            statusState.update { record(e).copy(syncing = false, synced = it.synced) }
        }
    }

    /** What a failed request means for the status line (`ServerLink.record`). */
    private fun record(error: Exception): SyncStatus = when (error) {
        is ApiError.Timeout -> SyncStatus(reachable = false, message = "The server took too long to answer. Try again.")
        is ApiError.Unreachable -> SyncStatus(reachable = false, message = "Can't reach the server. Check the connection and try again.")
        is ApiError.Forbidden -> SyncStatus(reachable = true, message = ApiError.FORBIDDEN_MESSAGE)
        is ApiError.Unreadable -> SyncStatus(reachable = true, message = error.message)
        is ApiError -> when {
            error.isUnauthorized -> SyncStatus(reachable = true, unauthorized = true, message = "The server didn't accept your sign-in (401). Sign out and sign in again.")
            else -> {
                val detail = (error as? ApiError.Http)?.detail ?: error.message.orEmpty()
                val code = error.httpStatus
                SyncStatus(reachable = true, message = if (detail.isEmpty()) "The server answered with error $code. Try again later." else "The server answered with error $code: $detail")
            }
        }
        else -> SyncStatus(reachable = statusState.value.reachable, message = error.message)
    }

    // endregion

    // region downloads

    override fun download(song: Song) {
        if (isOnPhone(song.id)) return
        downloads.enqueue(song)
    }

    override fun cancelDownload(id: String) {
        downloads.cancel(id)
        scope.launch(io) { discardPartial(id) }
    }

    /** Queues every song that is on the server but not on this phone (`ServerLink.downloadAllMissing`); songs already queued are skipped. */
    override fun downloadAllMissing(): Int {
        val busy = downloads.transfers.value.filterValues { it !is Transfer.Failed }.keys
        val pending = synchronized(lock) { all.filter { it.onServer != false && it.localOnly != true && it.id !in phone && it.id !in busy } }
        pending.forEach(downloads::enqueue)
        return pending.size
    }

    private fun discardPartial(id: String) {
        val file = audio.file(id)
        File(file.path + ".part").delete()
        File(file.path + ".part.meta").delete()
    }

    // endregion

    // region removing

    /** Removes the audio from the phone (AND-059). The song stays listed unless the server no longer knows it. Never touches the server. */
    override suspend fun removeAudio(id: String) = withContext(io) {
        removeAudioLocked(id)
        publish()
    }

    private fun removeAudioLocked(id: String) {
        synchronized(lock) {
            val song = all.firstOrNull { it.id == id } ?: return
            audio.file(id).delete()
            discardPartial(id)
            audio.forget(id)
            phone = phone - id
            if (song.localOnly == true) all = all.filter { it.id != id }
            save()
        }
    }

    /** Removes every phone copy except songs the server no longer lists (those would be lost for good); returns how many. */
    override suspend fun removeAllAudio(): Int = withContext(io) {
        val ids = synchronized(lock) { all.filter { it.id in phone && it.localOnly != true }.map { it.id } }
        ids.forEach(::removeAudioLocked)
        publish()
        ids.size
    }

    /** `DELETE /songs/{id}`, then the entry and the file leave the phone. A song the server no longer lists is removed from the phone only. */
    override suspend fun delete(id: String): Outcome<Unit> {
        val song = song(id)
        if (song?.localOnly != true) {
            try {
                api.deleteSong(id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                if (e.httpStatus != 404) return Outcome.Failed(e.message ?: "The song could not be deleted.")
            }
        }
        downloads.cancel(id)
        withContext(io) {
            synchronized(lock) {
                audio.file(id).delete()
                discardPartial(id)
                audio.forget(id)
                all = all.filter { it.id != id }
                phone = phone - id
                save()
            }
        }
        publish()
        return Outcome.Ok(Unit)
    }

    // endregion

    // region add and edit

    override suspend fun preview(url: String): Outcome<Preview> = call { api.preview(url) }

    /**
     * `POST /songs` with the Add sheet's payload; the server fetches the audio as on iOS. The song is listed at once
     * (no audio yet); with [download] its copy to the phone is queued, otherwise the catalog is synced when the server is done.
     */
    override suspend fun add(song: Song, download: Boolean): Outcome<Song> {
        val url = song.sourceURL ?: return Outcome.Failed("The song has no link.")
        val saved = call { api.addSong(url, Payloads.addMetadata(song), song.tags ?: emptyList()) }
        if (saved is Outcome.Failed) return saved
        val listed = song.copy(addedAt = song.addedAt ?: now(), onServer = false, localOnly = null)
        withContext(io) {
            synchronized(lock) {
                if (all.none { it.id == listed.id }) all = listOf(listed) + all
                pendingAdds += listed.id
                save()
            }
        }
        publish()
        if (download) downloads.enqueue(listed) else scope.launch { listWhenSaved(listed.id) }
        return Outcome.Ok(listed)
    }

    /** A song saved but not copied to the phone: syncs the catalog once the server has finished it (`ServerLink.listWhenSaved`). */
    private suspend fun listWhenSaved(id: String) {
        try {
            pollUntilSaved(id)
        } finally {
            synchronized(lock) { pendingAdds -= id }
        }
    }

    private suspend fun pollUntilSaved(id: String) {
        var misses = 0
        repeat(LIST_POLLS) {
            delay(LIST_POLL_MS)
            try {
                val status = api.status(id)
                misses = 0
                if (status.isDone) {
                    syncCatalog(auto = false)
                    return
                }
                if (status.isError) {
                    noticeFlow.tryEmit(status.failureMessage)
                    return
                }
            } catch (e: ApiError) {
                misses += 1
                if (misses >= 8 || !e.isTransient) {
                    noticeFlow.tryEmit(e.message ?: "The server could not be reached.")
                    return
                }
            }
        }
    }

    /** `PATCH /songs/{id}` with the Edit form's changes, then the stored song replaces the cached one (`LibraryStore.update`). */
    override suspend fun update(song: Song): Outcome<Song> {
        val base = song(song.id)
        val answer = call { api.updateSong(song.id, Payloads.edit(song, base)) }
        if (answer is Outcome.Failed) return answer
        val updated = (answer as Outcome.Ok).value.toSong()
        val merged = withContext(io) {
            synchronized(lock) {
                val i = all.indexOfFirst { it.id == updated.id }
                if (i < 0) return@synchronized updated
                val prev = all[i]
                val next = updated.copy(
                    thumbnail = updated.thumbnail ?: prev.thumbnail,
                    addedAt = updated.addedAt ?: prev.addedAt,
                    sources = updated.sources ?: prev.sources,
                    onServer = updated.onServer ?: prev.onServer,
                    localOnly = prev.localOnly,
                )
                all = all.toMutableList().also { it[i] = next }
                audio.sync(next)
                save()
                next
            }
        }
        publish()
        return Outcome.Ok(merged)
    }

    private suspend fun <T> call(block: suspend () -> T): Outcome<T> = try {
        Outcome.Ok(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiError) {
        Outcome.Failed(e.message ?: "The server could not be reached.")
    }

    // endregion

    /** `GET /me/usage`; null signed out or when the call fails. */
    override suspend fun usage(): Usage? {
        if (!signedIn()) return null
        return try {
            api.usage().toUsage()
        } catch (e: CancellationException) {
            throw e
        } catch (_: ApiError) {
            null
        }
    }

    override suspend fun phoneBytes(): Long = withContext(io) {
        val ids = synchronized(lock) { phone.toList() }
        ids.sumOf { audio.file(it).length() }
    }

    private companion object {
        const val LIST_POLL_MS = 2000L
        const val LIST_POLLS = 900
    }
}
