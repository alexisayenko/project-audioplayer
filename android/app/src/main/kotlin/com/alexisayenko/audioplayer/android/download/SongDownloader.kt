package com.alexisayenko.audioplayer.android.download

import com.alexisayenko.audioplayer.android.data.api.ApiClient
import com.alexisayenko.audioplayer.android.data.api.ApiError
import com.alexisayenko.audioplayer.android.data.api.SongStatus
import com.alexisayenko.audioplayer.android.data.store.HourlyPauseStore
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** The library as a download needs it; `LibraryRepository` implements it. */
interface DownloadTarget {
    /** The catalog record of a song, or null when it left the library. */
    fun song(id: String): Song?
    fun isOnPhone(id: String): Boolean

    /** The final file of the song's audio (`AudioFiles.reserve`); the partial copy is written beside it as `<name>.part`. */
    fun reserve(song: Song): File

    /** The file is in place under its final name: list the song as on the phone and write `phone-index.json`. */
    suspend fun arrived(song: Song)
}

/** How one run of a song's download ended. */
sealed interface DownloadResult {
    /** The file is on the phone. */
    data object Done : DownloadResult

    /** A network or server hiccup: worth another attempt later (WorkManager's backoff). */
    data class Retry(val message: String) : DownloadResult

    /** Failed until the person retries; [message] is words for them. */
    data class Failed(val message: String) : DownloadResult

    /** The hourly limit: nothing more is asked of the server until [untilMs] (AND-052). */
    data class Limited(val untilMs: Long) : DownloadResult
}

/** What a running download is doing, for the row and the notification. */
sealed interface DownloadStage {
    /** Waiting for a slot behind other downloads. */
    data object Waiting : DownloadStage

    /** The server is fetching the audio; [progress] is 0..1, null while the server has the job queued. */
    data class Fetching(val progress: Float?) : DownloadStage

    /** The file is being copied; [progress] is 0..1. */
    data class Copying(val progress: Float) : DownloadStage
}

/**
 * One song's way to the phone, client-paced as on iOS (AND-050; `ServerLink.getAudio`, `ingest` and `copy`,
 * `AlbumDownloader.process`): a song without audio on the server is fetched there first (`POST /songs/{id}/audio`, then
 * `GET /songs/{id}/status` every 1 to 2 s until `done` or `error`), then the file is copied ([FileCopier]) and handed to the
 * library. Plain Kotlin: the worker around it only translates the result for WorkManager.
 *
 * @param pollMs the pause between two status reads
 * @param sleep the wait between polls (replaced in tests)
 */
class SongDownloader(
    private val api: ApiClient,
    private val target: DownloadTarget,
    private val gate: DownloadGate,
    private val pause: HourlyPauseStore,
    private val copier: FileCopier = FileCopier(api),
    private val clock: () -> Long = System::currentTimeMillis,
    private val pollMs: Long = 1500,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    /** Songs waiting or running in this process: the N of "Downloading N songs". */
    val activeCount: Int get() = gate.activeCount

    /**
     * Brings song [id] onto the phone. [order] is when it was queued (earlier songs go first); [report] hears each stage.
     */
    suspend fun run(id: String, order: Long, report: suspend (DownloadStage) -> Unit = {}): DownloadResult {
        val song = target.song(id) ?: return DownloadResult.Failed(GONE)
        if (target.isOnPhone(id)) return DownloadResult.Done
        var fetched = false
        if (song.onServer == false) {
            fetch(id, order, report)?.let { return it }
            fetched = true
        }
        val first = copy(song, order, report)
        if (first !is CopyOutcome.NotOnServer) return first.result
        if (fetched) return DownloadResult.Retry("The audio is not on the server yet")
        fetch(id, order, report)?.let { return it }
        return copy(song, order, report).let { if (it is CopyOutcome.NotOnServer) DownloadResult.Retry("The audio is not on the server yet") else it.result }
    }

    private sealed interface CopyOutcome {
        val result: DownloadResult

        data class Ended(override val result: DownloadResult) : CopyOutcome
        data object NotOnServer : CopyOutcome {
            override val result: DownloadResult get() = DownloadResult.Failed("This song's audio is not on the server.")
        }
    }

    /** Null when the audio is on the server; otherwise how the run ends. */
    private suspend fun fetch(id: String, order: Long, report: suspend (DownloadStage) -> Unit): DownloadResult? {
        limited()?.let { return it }
        return gate.withSlot(id, DownloadPlanner.Kind.Fetch, order, onWait = { report(DownloadStage.Waiting) }) {
            limited()?.let { return@withSlot it }
            report(DownloadStage.Fetching(null))
            val known: SongStatus? = try {
                api.status(id)
            } catch (e: ApiError) {
                if (e.httpStatus == 404) null else return@withSlot refusal(e)
            }
            var current: SongStatus = if (known != null && known.isActive) {
                known
            } else {
                try {
                    api.requestAudio(id)
                } catch (e: ApiError) {
                    return@withSlot refusal(e)
                }
            }
            var misses = 0
            repeat(POLL_LIMIT) {
                if (current.isDone) return@withSlot null
                if (current.isError) return@withSlot failedJob(current)
                report(DownloadStage.Fetching(if (current.isQueued) null else (current.progress ?: 0.0).toFloat().coerceIn(0f, 1f)))
                sleep(pollMs)
                try {
                    current = api.status(id)
                    misses = 0
                } catch (e: ApiError) {
                    misses += 1
                    if (!e.isTransient) return@withSlot refusal(e)
                    if (misses >= MAX_MISSES) return@withSlot DownloadResult.Retry(e.message ?: "Can't reach the server")
                }
            }
            DownloadResult.Retry("The server took too long to fetch the audio")
        }
    }

    private suspend fun limited(): DownloadResult? {
        val until = pause.pausedUntil()
        return if (HourlyLimit.isPaused(clock(), until)) DownloadResult.Limited(until) else null
    }

    private suspend fun pauseFor(minutes: Int): DownloadResult {
        val until = HourlyLimit.pauseUntil(clock(), minutes)
        pause.setPausedUntil(until)
        return DownloadResult.Limited(until)
    }

    private suspend fun failedJob(status: SongStatus): DownloadResult =
        if (status.failureCode == "hourly_limit") pauseFor(HourlyLimit.retryMinutes(status.error ?: "")) else DownloadResult.Failed(status.failureMessage)

    /** A refused call as the end of the run: the hourly limit pauses, a passing fault retries, everything else fails with the server's words. */
    private suspend fun refusal(error: ApiError): DownloadResult = when {
        error.isHourlyLimit -> pauseFor(error.waitMinutes)
        error.isTransient -> DownloadResult.Retry(error.message ?: "Can't reach the server")
        error.httpStatus == 404 -> DownloadResult.Failed(GONE)
        else -> DownloadResult.Failed(error.message ?: "The download failed. Try again.")
    }

    private suspend fun copy(song: Song, order: Long, report: suspend (DownloadStage) -> Unit): CopyOutcome =
        gate.withSlot(song.id, DownloadPlanner.Kind.Copy, order, onWait = { report(DownloadStage.Waiting) }) {
            report(DownloadStage.Copying(0f))
            val dest = target.reserve(song)
            try {
                copier.copy(song.id, File(dest.path + ".part"), dest) { report(DownloadStage.Copying(it)) }
                target.arrived(song)
                CopyOutcome.Ended(DownloadResult.Done)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiError) {
                if (e.httpStatus == 404) CopyOutcome.NotOnServer else CopyOutcome.Ended(refusal(e))
            } catch (e: IOException) {
                CopyOutcome.Ended(DownloadResult.Retry("The copy was interrupted. It continues on its own."))
            }
        }

    private companion object {
        const val GONE = "The song left the library"
        const val MAX_MISSES = 8
        const val POLL_LIMIT = 1200
    }
}
