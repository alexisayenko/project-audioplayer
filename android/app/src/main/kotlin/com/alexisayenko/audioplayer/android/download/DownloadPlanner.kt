package com.alexisayenko.audioplayer.android.download

import kotlinx.coroutines.CompletableDeferred

/**
 * Orders the download queue and keeps the caps of AND-055: at most one server fetch at a time (the server allows one,
 * `USER_MAX_CONCURRENT_DOWNLOADS` = 1) and at most two file copies, as the iOS bulk and album downloads
 * (`ServerLink.bulkConcurrency`, `AlbumDownloader.concurrency`). Plain state with no clock and no threads: [DownloadGate]
 * puts the lock around it. WorkManager may start any number of workers; each does its work only between [grant] and [release].
 */
class DownloadPlanner(private val maxFetches: Int = 1, private val maxCopies: Int = 2) {
    /** The two kinds of work that are capped separately. */
    enum class Kind { Fetch, Copy }

    /** One song asking for a slot. [order] is when the song was queued; earlier goes first, the id breaks ties. */
    data class Entry(val id: String, val kind: Kind, val order: Long)

    private val waiting = ArrayList<Entry>()
    private val running = LinkedHashMap<String, Kind>()

    /** The ids waiting for a slot, first to start first. */
    val waitingIds: List<String> get() = waiting.map { it.id }

    /** The ids holding a slot. */
    val runningIds: Set<String> get() = running.keys.toSet()

    /** Songs waiting or running: the N of "Downloading N songs". */
    val activeCount: Int get() = (running.keys + waiting.map { it.id }).size

    fun running(kind: Kind): Int = running.values.count { it == kind }

    /** Puts the song in line for a slot of [kind]. Asking again replaces the earlier request; a song already running is left alone. */
    fun request(id: String, kind: Kind, order: Long) {
        if (id in running) return
        waiting.removeAll { it.id == id }
        waiting += Entry(id, kind, order)
        waiting.sortWith(compareBy<Entry> { it.order }.thenBy { it.id })
    }

    /** Starts everything the caps allow, in queue order, and returns what was started. */
    fun grant(): List<Entry> {
        val started = ArrayList<Entry>()
        val each = waiting.iterator()
        while (each.hasNext()) {
            val entry = each.next()
            val cap = if (entry.kind == Kind.Fetch) maxFetches else maxCopies
            if (running(entry.kind) >= cap) continue
            each.remove()
            running[entry.id] = entry.kind
            started += entry
        }
        return started
    }

    /** The song gives its slot back, or leaves the line. */
    fun release(id: String) {
        running.remove(id)
        waiting.removeAll { it.id == id }
    }
}

/**
 * The planner as the workers use it: [withSlot] suspends until the planner grants the song a slot, runs the block and gives
 * the slot back whatever happens (success, failure, cancellation). One instance is shared by all workers of the process.
 */
class DownloadGate(private val planner: DownloadPlanner = DownloadPlanner()) {
    private val lock = Any()
    private val owners = HashMap<String, CompletableDeferred<Unit>>()

    /** Songs waiting or running. */
    val activeCount: Int get() = synchronized(lock) { planner.activeCount }

    private fun grantLocked() {
        for (entry in planner.grant()) owners[entry.id]?.complete(Unit)
    }

    /**
     * Runs [block] while holding a slot of [kind]. [onWait] is called once when the song has to wait for one.
     */
    suspend fun <T> withSlot(id: String, kind: DownloadPlanner.Kind, order: Long, onWait: suspend () -> Unit = {}, block: suspend () -> T): T {
        val turn = CompletableDeferred<Unit>()
        synchronized(lock) {
            planner.release(id)
            owners.put(id, turn)?.cancel()
            planner.request(id, kind, order)
            grantLocked()
        }
        try {
            if (!turn.isCompleted) onWait()
            turn.await()
            return block()
        } finally {
            synchronized(lock) {
                if (owners[id] === turn) {
                    owners.remove(id)
                    planner.release(id)
                    grantLocked()
                }
            }
        }
    }
}
