package com.alexisayenko.audioplayer.android.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.alexisayenko.audioplayer.android.model.Song

/**
 * What a [DownloadWorker] needs from the app. WorkManager creates workers by itself, also in a process the system started
 * only for them, so the worker cannot be handed its dependencies: `App.onCreate` builds one environment and puts it in
 * [DownloadEnvironmentHolder] before any worker runs.
 */
interface DownloadEnvironment {
    /** Runs one song's download. */
    val downloader: SongDownloader

    /** Re-queues a song that met the hourly limit. */
    val queue: WorkDownloadQueue

    /** The song's record, for the notification text; null when unknown. */
    fun song(id: String): Song?
}

/** The environment `App` normally builds: the downloader, the queue and the library for the notification's song names. */
class DefaultDownloadEnvironment(
    override val downloader: SongDownloader,
    override val queue: WorkDownloadQueue,
    private val library: DownloadTarget,
) : DownloadEnvironment {
    override fun song(id: String): Song? = library.song(id)
}

/** The one process-wide slot Android forces on us: where [DownloadWorker] finds the app's services. Set once in `App.onCreate`. */
object DownloadEnvironmentHolder {
    @Volatile
    var environment: DownloadEnvironment? = null
}

/**
 * One song's download as WorkManager work (AND-051, AND-054): unique work `download:<song id>`, a foreground worker of type
 * `dataSync` with the one "Downloading N songs" notification, progress through `setProgress`. The work itself is
 * [SongDownloader]; this class only translates its result: done, retry with backoff, failed with a message, or put back
 * behind the hourly limit (AND-052). The notification permission is not needed for the work to run.
 */
class DownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private var lastNotifiedPercent = -100
    private var lastNotifiedStage: String? = null

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo(null, null)

    override suspend fun doWork(): Result {
        val id = inputData.getString(DownloadWork.KEY_ID) ?: return failure("The download failed. Try again.")
        val environment = DownloadEnvironmentHolder.environment ?: return Result.retry()
        val order = inputData.getLong(DownloadWork.KEY_ORDER, 0)
        val song = environment.song(id)
        showForeground(environment, song, null)
        val result = environment.downloader.run(id, order) { stage ->
            setProgress(DownloadWork.progressData(stage))
            if (shouldNotify(stage)) showForeground(environment, song, stage)
        }
        return when (result) {
            DownloadResult.Done -> Result.success()
            is DownloadResult.Retry -> if (runAttemptCount + 1 >= MAX_ATTEMPTS) failure(result.message) else Result.retry()
            is DownloadResult.Failed -> failure(result.message)
            is DownloadResult.Limited -> {
                environment.queue.enqueuePaused(id, order, result.untilMs)
                Result.success()
            }
        }
    }

    private fun failure(message: String): Result = Result.failure(Data.Builder().putString(DownloadWork.KEY_MESSAGE, message).build())

    private fun shouldNotify(stage: DownloadStage): Boolean {
        val name = stage::class.simpleName
        val percent = when (stage) {
            is DownloadStage.Copying -> (stage.progress * 100).toInt()
            is DownloadStage.Fetching -> ((stage.progress ?: 0f) * 100).toInt()
            DownloadStage.Waiting -> 0
        }
        if (name == lastNotifiedStage && percent - lastNotifiedPercent in 0 until NOTIFY_STEP_PERCENT) return false
        lastNotifiedStage = name
        lastNotifiedPercent = percent
        return true
    }

    /** Becomes (or updates) the foreground work. Refused when the app may not start a foreground service right now: the download runs anyway. */
    private suspend fun showForeground(environment: DownloadEnvironment, song: Song?, stage: DownloadStage?) {
        try {
            setForeground(foregroundInfo(song, stage, environment.downloader.activeCount))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            // No foreground service and no notification; the work goes on within WorkManager's own limits.
        }
    }

    private fun foregroundInfo(song: Song?, stage: DownloadStage?, count: Int = 1): ForegroundInfo {
        val notification = notification(applicationContext, song, stage, count)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        /** The id of the one download notification every worker shares. */
        const val NOTIFICATION_ID = 4101
        const val CHANNEL_ID = "downloads"
        private const val MAX_ATTEMPTS = 10
        private const val NOTIFY_STEP_PERCENT = 5

        /** "Downloading N songs". */
        fun summary(count: Int): String = if (count <= 1) "Downloading 1 song" else "Downloading $count songs"

        /** The second line: the song and what is happening to it. */
        fun detail(song: Song?, stage: DownloadStage?): String {
            val name = song?.let { if (it.artist.isBlank()) it.title else "${it.artist} - ${it.title}" } ?: ""
            val doing = when (stage) {
                null, DownloadStage.Waiting -> "waiting"
                is DownloadStage.Fetching -> stage.progress?.let { "fetching on the server ${(it * 100).toInt()}%" } ?: "fetching on the server"
                is DownloadStage.Copying -> "${(stage.progress * 100).toInt()}%"
            }
            return if (name.isEmpty()) doing else "$name: $doing"
        }

        private fun notification(context: Context, song: Song?, stage: DownloadStage?, count: Int): Notification {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager != null && manager.getNotificationChannel(CHANNEL_ID) == null) {
                manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW))
            }
            val percent = when (stage) {
                is DownloadStage.Copying -> (stage.progress * 100).toInt()
                is DownloadStage.Fetching -> stage.progress?.let { (it * 100).toInt() }
                else -> null
            }
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(summary(count))
                .setContentText(detail(song, stage))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setProgress(100, percent ?: 0, percent == null)
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { open ->
                builder.setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            return builder.build()
        }
    }
}
