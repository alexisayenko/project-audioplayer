package com.alexisayenko.audioplayer.android.download

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.alexisayenko.audioplayer.android.data.AppSettings
import com.alexisayenko.audioplayer.android.data.Transfer
import com.alexisayenko.audioplayer.android.model.Song
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The downloads as the library uses them; the real one is [WorkDownloadQueue]. */
interface DownloadQueue {
    /** Downloads in flight, paused or failed, by song id (AND-033). */
    val transfers: StateFlow<Map<String, Transfer>>

    /** Queues the song; a song already queued or running is left as it is. */
    fun enqueue(song: Song)

    /** Stops and forgets the song's download; its row shows no transfer afterwards. */
    fun cancel(id: String)

    /** Stops every download, e.g. on sign-out. */
    fun cancelAll()
}

/** What the UI needs of one `WorkInfo`, as plain values so the mapping can be tested without WorkManager. */
data class WorkSnapshot(
    val songId: String,
    val state: State,
    /** The worker's last `setProgress`: "waiting", "fetching" or "copying"; null before the first. */
    val stage: String? = null,
    /** 0..1, or null when the stage has no number yet. */
    val progress: Float? = null,
    /** The failure in words, from the work's output. */
    val message: String? = null,
    /** Set on work that was re-queued behind the hourly limit: when it resumes (epoch milliseconds). */
    val pausedUntilMs: Long? = null,
) {
    enum class State { Enqueued, Blocked, Running, Succeeded, Failed, Cancelled }
}

/** From WorkManager's view of the download work to the [Transfer] the rows show (AND-033). The state is derived, never stored. */
object TransferMapper {
    const val DEFAULT_FAILURE = "The download failed. Try again."

    /** Null means no transfer: the work finished, was cancelled, or never existed. */
    fun map(work: WorkSnapshot, nowMs: Long): Transfer? = when (work.state) {
        WorkSnapshot.State.Enqueued ->
            if (work.pausedUntilMs != null && work.pausedUntilMs > nowMs) Transfer.Paused(work.pausedUntilMs) else Transfer.Waiting
        WorkSnapshot.State.Blocked -> Transfer.Waiting
        WorkSnapshot.State.Running -> when (work.stage) {
            STAGE_FETCHING -> Transfer.Fetching(work.progress)
            STAGE_COPYING -> Transfer.Copying(work.progress ?: 0f)
            else -> Transfer.Waiting
        }
        WorkSnapshot.State.Failed -> Transfer.Failed(work.message?.takeIf { it.isNotEmpty() } ?: DEFAULT_FAILURE)
        WorkSnapshot.State.Succeeded, WorkSnapshot.State.Cancelled -> null
    }

    /** One entry per song; of several works for one song the unfinished one counts, else the last. */
    fun transfers(works: List<WorkSnapshot>, nowMs: Long): Map<String, Transfer> {
        val out = LinkedHashMap<String, Transfer>()
        for ((id, group) in works.groupBy { it.songId }) {
            val live = group.lastOrNull { it.state == WorkSnapshot.State.Running }
                ?: group.lastOrNull { it.state == WorkSnapshot.State.Enqueued || it.state == WorkSnapshot.State.Blocked }
                ?: group.last()
            map(live, nowMs)?.let { out[id] = it }
        }
        return out
    }

    const val STAGE_WAITING = "waiting"
    const val STAGE_FETCHING = "fetching"
    const val STAGE_COPYING = "copying"
}

/** The names, tags and data keys of the download work. */
object DownloadWork {
    const val TAG = "download"
    const val SONG_TAG = "song:"
    const val ORDER_TAG = "order:"
    const val PAUSED_TAG = "paused:"
    const val KEY_ID = "id"
    const val KEY_ORDER = "order"
    const val KEY_STAGE = "stage"
    const val KEY_PROGRESS = "progress"
    const val KEY_MESSAGE = "message"

    /** The unique work name of a song's download (AND-051). */
    fun name(id: String): String = "download:$id"

    /** The worker's progress for `setProgress`. */
    fun progressData(stage: DownloadStage): Data = when (stage) {
        DownloadStage.Waiting -> Data.Builder().putString(KEY_STAGE, TransferMapper.STAGE_WAITING)
        is DownloadStage.Fetching -> Data.Builder().putString(KEY_STAGE, TransferMapper.STAGE_FETCHING).putFloat(KEY_PROGRESS, stage.progress ?: -1f)
        is DownloadStage.Copying -> Data.Builder().putString(KEY_STAGE, TransferMapper.STAGE_COPYING).putFloat(KEY_PROGRESS, stage.progress)
    }.build()

    private fun tagValue(tags: Set<String>, prefix: String): String? = tags.firstOrNull { it.startsWith(prefix) }?.removePrefix(prefix)

    /** Null for work that is not a song download. */
    fun snapshot(info: WorkInfo): WorkSnapshot? {
        val id = tagValue(info.tags, SONG_TAG) ?: return null
        val state = when (info.state) {
            WorkInfo.State.ENQUEUED -> WorkSnapshot.State.Enqueued
            WorkInfo.State.BLOCKED -> WorkSnapshot.State.Blocked
            WorkInfo.State.RUNNING -> WorkSnapshot.State.Running
            WorkInfo.State.SUCCEEDED -> WorkSnapshot.State.Succeeded
            WorkInfo.State.FAILED -> WorkSnapshot.State.Failed
            WorkInfo.State.CANCELLED -> WorkSnapshot.State.Cancelled
        }
        return WorkSnapshot(
            songId = id,
            state = state,
            stage = info.progress.getString(KEY_STAGE),
            progress = info.progress.getFloat(KEY_PROGRESS, -1f).takeIf { it >= 0f },
            message = info.outputData.getString(KEY_MESSAGE),
            pausedUntilMs = tagValue(info.tags, PAUSED_TAG)?.toLongOrNull(),
        )
    }

    /** The order a work was queued with, from its tags. */
    fun order(info: WorkInfo): Long? = tagValue(info.tags, ORDER_TAG)?.toLongOrNull()

    /**
     * The request for one song (AND-051): network `CONNECTED`, or `UNMETERED` while "Use mobile data" is off; exponential
     * backoff; with [pausedUntilMs] it starts only when the hourly limit lifts (AND-052). [replacing] is the id of queued
     * work this request updates in place.
     */
    fun request(id: String, order: Long, useMobileData: Boolean, nowMs: Long, pausedUntilMs: Long? = null, replacing: UUID? = null): OneTimeWorkRequest {
        val builder = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(Data.Builder().putString(KEY_ID, id).putLong(KEY_ORDER, order).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(if (useMobileData) NetworkType.CONNECTED else NetworkType.UNMETERED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
            .addTag(TAG)
            .addTag(SONG_TAG + id)
            .addTag(ORDER_TAG + order)
        if (replacing != null) builder.setId(replacing)
        if (pausedUntilMs != null && pausedUntilMs > nowMs) {
            builder.addTag(PAUSED_TAG + pausedUntilMs).setInitialDelay(pausedUntilMs - nowMs, TimeUnit.MILLISECONDS)
        }
        return builder.build()
    }

    private const val BACKOFF_SECONDS = 30L
}

/**
 * The downloads on WorkManager (AND-051): one unique work `download:<song id>` per song with `ExistingWorkPolicy.KEEP`, so
 * the work survives process death and reboot and a second tap changes nothing. [transfers] is derived from the `WorkInfo`s.
 *
 * @param scope a scope that lives as long as the app
 */
class WorkDownloadQueue(
    private val work: WorkManager,
    private val settings: AppSettings,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
) : DownloadQueue {
    private val lastOrder = AtomicLong(0)

    override val transfers: StateFlow<Map<String, Transfer>> = work.getWorkInfosByTagFlow(DownloadWork.TAG)
        .map { infos -> TransferMapper.transfers(infos.mapNotNull(DownloadWork::snapshot), clock()) }
        .stateIn(scope, SharingStarted.Eagerly, emptyMap())

    init {
        scope.launch { settings.useMobileData.drop(1).collect { applyNetworkSetting(it) } }
    }

    private fun nextOrder(): Long = lastOrder.updateAndGet { maxOf(it + 1, clock()) }

    override fun enqueue(song: Song) {
        val request = DownloadWork.request(song.id, nextOrder(), settings.useMobileData.value, clock())
        work.enqueueUniqueWork(DownloadWork.name(song.id), ExistingWorkPolicy.KEEP, request)
    }

    /**
     * Puts the song back in the queue to start when the hourly limit lifts at [untilMs] (AND-052). Replaces the work that
     * just met the limit, so call it as that worker's last act.
     */
    fun enqueuePaused(id: String, order: Long, untilMs: Long) {
        val request = DownloadWork.request(id, order, settings.useMobileData.value, clock(), pausedUntilMs = untilMs)
        work.enqueueUniqueWork(DownloadWork.name(id), ExistingWorkPolicy.REPLACE, request)
    }

    override fun cancel(id: String) {
        work.cancelUniqueWork(DownloadWork.name(id))
    }

    override fun cancelAll() {
        work.cancelAllWorkByTag(DownloadWork.TAG)
    }

    /** Gives the queued (not yet running) downloads the network rule of the "Use mobile data" switch as it is now. */
    suspend fun applyNetworkSetting(useMobileData: Boolean) = withContext(Dispatchers.IO) {
        val infos = runCatching { work.getWorkInfosByTag(DownloadWork.TAG).get() }.getOrNull() ?: return@withContext
        for (info in infos) {
            if (info.state != WorkInfo.State.ENQUEUED && info.state != WorkInfo.State.BLOCKED) continue
            val snapshot = DownloadWork.snapshot(info) ?: continue
            val order = DownloadWork.order(info) ?: nextOrder()
            val request = DownloadWork.request(snapshot.songId, order, useMobileData, clock(), snapshot.pausedUntilMs, replacing = info.id)
            runCatching { work.updateWork(request) }
        }
    }
}
