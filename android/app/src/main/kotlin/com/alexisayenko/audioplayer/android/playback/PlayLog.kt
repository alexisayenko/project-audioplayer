package com.alexisayenko.audioplayer.android.playback

import java.io.File
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Where the play log sends a batch: `POST /plays` with the body [PlayLog.body]. Returns the HTTP status, or null when there
 * was no answer (no network) or nobody is signed in. The app wires it to its API client.
 */
fun interface PlaySink {
    suspend fun post(batchKey: String, plays: List<PlayRecord>): Int?
}

/**
 * Finished plays waiting for the server: the Kotlin port of the Swift `PlayQueue` (IOS-088 to IOS-090, AND-065). They are kept
 * in `queue.json` under [directory], sent in batches of at most [BATCH_MAX] with a stable batch key, retried with the same key
 * after a failure (30 s, doubling up to 900 s) and never in the way of playback: every call returns at once and the sending
 * runs in [scope].
 *
 * Not thread-safe: call it from the thread [scope] dispatches on (the main thread in the app).
 */
class PlayLog(
    private val directory: File,
    private val sink: PlaySink,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    private val keyFactory: () -> String = { UUID.randomUUID().toString() },
) {
    /** A set of plays on its way to the server under one key, so a retry is never counted twice. */
    @Serializable
    data class Batch(val key: String, val plays: List<PlayRecord>)

    @Serializable
    private data class State(val queue: List<PlayRecord> = emptyList(), val batch: Batch? = null)

    @Serializable
    private data class Body(@SerialName("batch_key") val batchKey: String, val plays: List<PlayRecord>)

    private var state: State = PlayStore.read(State.serializer(), FILE, directory) ?: State()
    private var inflight = false
    private var failures = 0
    private var retryAt: Long? = null
    private var retryJob: Job? = null

    /** Called after the server accepted a batch (the iOS `playsUploaded` notice), e.g. to refresh the listen counts. */
    var onUploaded: (() -> Unit)? = null

    /** Plays not yet confirmed by the server: the batch in flight and the ones waiting. */
    val pendingPlays: List<PlayRecord> get() = (state.batch?.plays ?: emptyList()) + state.queue

    /** Queues a finished play (rounded to a tenth of a second) and tries to send. Plays under [MIN_PLAY] seconds are dropped. */
    fun add(record: PlayRecord) {
        if (record.listened < MIN_PLAY) return
        val rounded = record.copy(listened = Math.round(record.listened * 10) / 10.0)
        var queue = state.queue + rounded
        if (queue.size > CAP) queue = queue.drop(queue.size - CAP)
        state = state.copy(queue = queue)
        save()
        flush()
    }

    /**
     * Sends the next batch unless one is in flight or a retry is still waiting. [force] forgets the waiting time: use it when
     * the person signs in or the network comes back.
     */
    fun flush(force: Boolean = false) {
        if (force) retryAt = null
        if (inflight) return
        if (retryAt?.let { it > now() } == true) return
        val batch = nextBatch() ?: return
        inflight = true
        scope.launch { send(batch) }
    }

    private fun nextBatch(): Batch? {
        state.batch?.let { return it }
        if (state.queue.isEmpty()) return null
        val batch = Batch(keyFactory(), state.queue.take(BATCH_MAX))
        state = State(queue = state.queue.drop(batch.plays.size), batch = batch)
        save()
        return batch
    }

    private suspend fun send(batch: Batch) {
        val status = try {
            sink.post(batch.key, batch.plays)
        } catch (e: CancellationException) {
            inflight = false
            throw e
        } catch (_: Exception) {
            null
        }
        inflight = false
        if (status != null && (status in 200..299 || status in DROP_STATUSES)) {
            state = state.copy(batch = null)
            save()
            failures = 0
            retryAt = null
            if (status in 200..299) onUploaded?.invoke()
            flush()
        } else {
            failures += 1
            val wait = minOf(FIRST_RETRY_MS * (1L shl minOf(failures - 1, 16)), MAX_RETRY_MS)
            retryAt = now() + wait
            retryJob?.cancel()
            retryJob = scope.launch {
                delay(wait)
                flush(force = true) // the wait is over by the timer; never let clock skew swallow the retry
            }
        }
    }

    private fun save() = PlayStore.write(State.serializer(), state, FILE, directory)

    companion object {
        /** At most this many plays wait; the oldest are dropped first. */
        const val CAP = 1000

        /** At most this many plays go in one request. */
        const val BATCH_MAX = 200

        /** Plays shorter than this, in seconds, are not recorded. */
        const val MIN_PLAY = 5.0

        /** Answers that mean "this batch will never be accepted": it is dropped, not retried. */
        val DROP_STATUSES: Set<Int> = setOf(400, 404, 409, 410, 413, 422)

        /** The first retry waits 30 s; each further failure doubles it. */
        const val FIRST_RETRY_MS = 30_000L

        /** No retry waits longer than 900 s. */
        const val MAX_RETRY_MS = 900_000L

        private const val FILE = "queue.json"

        /** The JSON body of `POST /plays`: `{"batch_key": ..., "plays": [{"timestamp", "song_id", "listened_s", "cont"?}]}`. */
        fun body(batchKey: String, plays: List<PlayRecord>): String =
            PlayStore.json.encodeToString(Body.serializer(), Body(batchKey, plays))
    }
}
