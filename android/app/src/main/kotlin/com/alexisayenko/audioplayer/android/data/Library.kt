package com.alexisayenko.audioplayer.android.data

import com.alexisayenko.audioplayer.android.model.Preview
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlinx.coroutines.flow.StateFlow

/** Where a song's audio is (ADR-0010). Derived from the catalog and the files on the phone, never stored. */
enum class AudioState { None, Server, Phone }

/** One song on its way to the phone (AND-033). No entry means no transfer. */
sealed interface Transfer {
    /** Queued behind other downloads. */
    data object Waiting : Transfer

    /** The server is fetching and converting the audio; [progress] is 0..1 when the server reports it. */
    data class Fetching(val progress: Float?) : Transfer

    /** The file is being copied to the phone; [progress] is 0..1. */
    data class Copying(val progress: Float) : Transfer

    /** Paused by the server's hourly limit until [resumeAtMs] (epoch milliseconds). */
    data class Paused(val resumeAtMs: Long) : Transfer

    /** Failed for good or until Retry; [message] is words for the person. */
    data class Failed(val message: String) : Transfer
}

/** The link to the server as the screens show it (the iOS `ServerLink` flags). */
data class SyncStatus(
    /** A catalog sync is running. */
    val syncing: Boolean = false,
    /** At least one catalog sync has succeeded in this run. */
    val synced: Boolean = false,
    /** Null until the first call answers or fails. */
    val reachable: Boolean? = null,
    /** The server refused the token (expired sign-in). */
    val unauthorized: Boolean = false,
    /** What went wrong, in words for the person; null when fine. */
    val message: String? = null,
)

/** `GET /me/usage`: the quota line in Settings. Null fields mean "no limit" (the owner). */
data class Usage(val songs: Int, val maxSongs: Int?, val bytes: Long, val maxBytes: Long?)

/** The outcome of a server write, with words for the person on failure. */
sealed interface Outcome<out T> {
    data class Ok<T>(val value: T) : Outcome<T>
    data class Failed(val message: String) : Outcome<Nothing>
}

/**
 * The library as the screens see it: the cached catalog, the songs on this phone and the downloads in flight
 * (the iOS `LibraryStore` plus `ServerLink`). Signed out, [songs] holds only the songs on the phone and nothing reads the server (AND-002).
 */
interface Library {
    /** Every song of the catalog in server order, or only the phone's songs when signed out. */
    val songs: StateFlow<List<Song>>

    /** Ids of the songs whose audio file is on this phone. */
    val phoneIds: StateFlow<Set<String>>

    /** Downloads in flight or failed, by song id. */
    val transfers: StateFlow<Map<String, Transfer>>
    val status: StateFlow<SyncStatus>

    fun audioState(song: Song): AudioState

    /** The audio file of a song on the phone, or null. */
    fun fileFor(id: String): File?

    /** Fetches the catalog (`If-None-Match`); no-op when signed out. */
    suspend fun syncCatalog()

    /** Queues the song's audio for download to the phone (fetches on the server first when needed). */
    fun download(song: Song)
    fun cancelDownload(id: String)

    /** Queues every catalog song that is not on the phone; returns how many were queued. */
    fun downloadAllMissing(): Int

    /** Deletes the file from the phone; never touches the server. */
    suspend fun removeAudio(id: String)

    /** Removes every downloaded file; returns how many. */
    suspend fun removeAllAudio(): Int

    /** Deletes the song from the server library and from the phone. */
    suspend fun delete(id: String): Outcome<Unit>

    /** `POST /preview` for a pasted link. */
    suspend fun preview(url: String): Outcome<Preview>

    /** `POST /songs`: saves a new catalog song; with [download] also queues its audio. */
    suspend fun add(song: Song, download: Boolean): Outcome<Song>

    /** `PUT /songs/{id}`: saves edited metadata. */
    suspend fun update(song: Song): Outcome<Song>

    suspend fun usage(): Usage?

    /** Bytes used by the audio files on this phone. */
    suspend fun phoneBytes(): Long
}
