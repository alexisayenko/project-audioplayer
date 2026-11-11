package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import kotlin.random.Random

/**
 * The one thing that makes sound, as the queue rules see it: one song at a time, like the iOS `AVPlayer` that
 * `PlayerService` drives. The service implements it over ExoPlayer; tests and `FakePlayerController` use an in-memory one.
 * Positions are milliseconds.
 */
internal interface AudioOutput {
    val positionMs: Long

    /** The length of the loaded song, or 0 while it is not known. */
    val durationMs: Long

    /** Sound is coming out right now (not paused, not buffering, not held back by a call). */
    val isPlaying: Boolean

    /** Replaces what is loaded with [file] at [positionMs] and, with [play], starts it. */
    fun load(song: Song, file: File, positionMs: Long, play: Boolean)

    /** Starts or continues the loaded song. */
    fun play()

    fun pause()

    fun seekTo(positionMs: Long)

    /** Unloads everything. */
    fun clear()
}

/**
 * The queue and its rules: the Kotlin counterpart of the iOS `PlayerService` (IOS-115), without any Android class, so the
 * whole behaviour runs in JVM tests. It owns the queue, the current index, shuffle, repeat, the shuffle round and history,
 * decides every Next and Previous through [QueueAdvance] and [ShufflePick], feeds the [PlayRecorder] and saves through
 * [PlaybackPersistence] by the resume rule (AND-063 to AND-066).
 *
 * A song is loaded only from the file [fileFor] returns; a song without a file is skipped and reported through [onEvent],
 * never fetched (AND-066). Every change is published as one [PlayerState] through [onState].
 *
 * Not thread-safe: the service calls it on the main thread only.
 */
internal class PlaybackEngine(
    private val output: AudioOutput,
    private val fileFor: (String) -> File?,
    private val listenCounts: () -> Map<String, Int>? = { null },
    private val recorder: PlayRecorder? = null,
    private val playLog: PlayLog? = null,
    private val persistence: PlaybackPersistence? = null,
    private val random: Random = Random.Default,
    private val now: () -> Long = System::currentTimeMillis,
    private val onEvent: (PlaybackEvent) -> Unit = {},
    private val onState: (PlayerState) -> Unit = {},
) {
    var queue: List<Song> = emptyList()
        private set
    var index: Int? = null
        private set

    /** The person wants sound (true while buffering too), as the iOS `isPlaying`. */
    var isPlaying = false
        private set
    var queueTags: List<String> = emptyList()
        private set
    var shuffle = false
        private set
    var repeat = RepeatMode.Off
        private set

    /** Set when the current song could not be played; cleared when a song loads. */
    var failedSongId: String? = null
        private set

    private var suppressed = false
    private var played: List<String> = emptyList()
    private var history: List<String> = emptyList()
    private val ranker = ShuffleRanker()
    private var attachedId: String? = null
    private var needsItem = false
    private var savedKey: Triple<List<String>, Int?, List<String>>? = null

    init {
        persistence?.savedModes()?.let {
            shuffle = it.shuffle
            repeat = repeatModeOf(it.repeat)
        }
    }

    val current: Song? get() = index?.let(queue::getOrNull)

    val positionMs: Long get() = if (needsItem || current == null) 0 else output.positionMs

    /** The length of the current song: the file's once it is known, else the catalog's. */
    val durationMs: Long
        get() {
            val song = current ?: return 0
            val real = if (needsItem) 0 else output.durationMs
            return if (real > 0) real else ((song.duration ?: 0.0) * 1000).toLong()
        }

    /** Whether Next would go somewhere. */
    val hasNext: Boolean get() = cursor()?.let(QueueAdvance::hasNext) ?: false

    val state: PlayerState
        get() = PlayerState(queue, index ?: -1, isPlaying && !suppressed, positionMs, durationMs, shuffle, repeat, failedSongId)

    // region Queue

    /** Replaces the queue with [songs] and starts at [startIndex]. */
    fun play(songs: List<Song>, startIndex: Int) {
        val startId = songs.getOrNull(startIndex)?.id
        queue = songs.distinctBy { it.id }
        queueTags = emptyList()
        played = emptyList()
        history = emptyList()
        index = null
        if (queue.isEmpty()) {
            isPlaying = false
            detach()
            return publish()
        }
        val start = queue.indexOfFirst { it.id == startId }.coerceAtLeast(0)
        if (!load(start, remember = false)) {
            index = start
            isPlaying = false
            detach()
            needsItem = true
        }
        publish()
    }

    /** Replaces the queue with [songs] and starts the first, or one from the least-played tier when shuffle is on. */
    fun playAll(songs: List<Song>) {
        val unique = songs.distinctBy { it.id }
        if (unique.isEmpty()) return
        val start = if (shuffle) ShufflePick.firstIndex(unique.map { it.id }, pendingCounts(), random) else 0
        play(unique, start ?: 0)
    }

    /** Inserts [song] after the current one and plays it. */
    fun playNow(song: Song) {
        val cur = current ?: return play(listOf(song), 0)
        if (song.id == cur.id) {
            seekTo(0)
            return resume()
        }
        if (fileFor(song.id) == null) return report(listOf(song))
        val rest = queue.filter { it.id != song.id }.toMutableList()
        val at = rest.indexOfFirst { it.id == cur.id }
        rest.add(at + 1, song)
        queue = rest
        index = at
        load(at + 1)
        publish()
    }

    /** Inserts [song] right after the current one. */
    fun playNext(song: Song) {
        val cur = current ?: return play(listOf(song), 0)
        if (song.id == cur.id) return
        val rest = queue.filter { it.id != song.id }.toMutableList()
        val at = rest.indexOfFirst { it.id == cur.id }
        rest.add(at + 1, song)
        queue = rest
        index = at
        publish()
    }

    /** Appends the songs not yet in the queue; returns how many were added. With an empty queue the first one is cued, paused. */
    fun enqueue(songs: List<Song>): Int {
        val fresh = fresh(queue, songs)
        if (fresh.isEmpty()) return 0
        queue = queue + fresh
        if (index == null) {
            index = 0
            played = listOf(queue[0].id)
            cue(0, 0)
        }
        publish()
        return fresh.size
    }

    /** Moves the row at [from] to the final position [to]; the current song stays current. */
    fun moveQueueItem(from: Int, to: Int) {
        val moved = QueueEdit.movedTo(queue, from, to)
        if (moved === queue) return
        val playingId = current?.id
        queue = moved
        if (playingId != null) index = queue.indexOfFirst { it.id == playingId }.takeIf { it >= 0 } ?: index
        publish()
    }

    /** Removes the row at [at]. When it was the current song, playback stops and the nearest remaining song is cued. */
    fun removeFromQueue(at: Int) {
        if (at !in queue.indices) return
        val playingId = current?.id
        val was = index ?: 0
        queue = queue.filterIndexed { i, _ -> i != at }
        if (playingId == null) return publish()
        val still = queue.indexOfFirst { it.id == playingId }
        if (still >= 0) {
            index = still
            return publish()
        }
        isPlaying = false
        output.pause()
        if (queue.isEmpty()) {
            index = null
            detach()
            return publish()
        }
        val next = minOf(was, queue.lastIndex)
        index = next
        cue(next, 0)
        publish()
    }

    /** Keeps only the current song. */
    fun clearQueue() {
        val keep = current
        queue = listOfNotNull(keep)
        index = if (keep == null) null else 0
        queueTags = emptyList()
        played = listOfNotNull(keep?.id)
        history = emptyList()
        publish()
    }

    /** Plays the row at [i] from its start. */
    fun jumpTo(i: Int) {
        load(i)
        publish()
    }

    // endregion

    // region Transport

    fun toggle() = if (isPlaying) pause() else resume()

    fun resume() {
        val cur = current ?: return
        if (needsItem || failedSongId == cur.id) {
            val file = fileFor(cur.id)
            if (file == null) {
                failedSongId = cur.id
                report(listOf(cur))
            } else {
                install(cur, file, 0, play = true)
            }
        } else {
            isPlaying = true
            output.play()
        }
        publish()
    }

    fun pause() {
        val heard = if (isPlaying && output.isPlaying) output.positionMs / 1000.0 else null
        isPlaying = false
        output.pause()
        recorder?.paused(heard)
        saveNow()
        publish()
    }

    fun next() = advance(manual = true)

    fun previous() {
        val cursor = cursor() ?: return
        val outcome = QueueAdvance.previous(cursor, positionMs / 1000.0, history)
        history = outcome.history
        apply(outcome.step, remember = false, forward = false, auto = false)
    }

    fun seekTo(positionMs: Long) {
        if (current == null || needsItem) return
        recorder?.seeked()
        val length = durationMs
        output.seekTo(if (length > 0) positionMs.coerceIn(0, length) else positionMs.coerceAtLeast(0))
        saveNow()
        publish()
    }

    /** A relative seek, clamped to 0 and the length (PLY-022). */
    fun skipBy(deltaMs: Long) {
        seekTo((positionMs + deltaMs).coerceIn(0, maxOf(durationMs, 0)))
    }

    /** Turns shuffle on or off; either way a new round starts from the current song. */
    fun setShuffle(on: Boolean) {
        shuffle = on
        played = listOfNotNull(current?.id)
        history = emptyList()
        persistence?.saveModes(shuffle, repeat)
        publish()
    }

    fun setRepeat(mode: RepeatMode) {
        repeat = mode
        persistence?.saveModes(shuffle, repeat)
        publish()
    }

    // endregion

    // region Lifecycle and signals from the output

    /**
     * Puts the saved queue back with its song cued and paused, at the position the resume rule allows (AND-064), then starts
     * saving. Songs whose file is gone are dropped. Call it once, when the library is known; [saved] may be null.
     */
    fun restore(saved: SavedPlayback?, song: (String) -> Song?) {
        if (index == null && saved != null) {
            PlaybackPersistence.resolve(saved, song) { fileFor(it.id) != null }?.let { restored ->
                queue = restored.songs
                queueTags = restored.tags
                index = restored.index
                played = listOf(restored.songs[restored.index].id)
                cue(restored.index, (restored.position * 1000).toLong())
            }
        }
        savedKey = Triple(queue.map { it.id }, index, queueTags)
        persistence?.begin(if (current != null) snapshot() else null)
        onState(state)
    }

    /** Called about twice a second while a song is loaded: counts what is heard and saves the position when due. */
    fun tick() {
        if (current == null || needsItem) return
        recorder?.tick(if (isPlaying && output.isPlaying) attachedId else null, output.positionMs / 1000.0)
        persistence?.positionChanged(snapshot(), isPlaying)
    }

    /** The loaded song played to its end. */
    fun onEnded() {
        if (!isPlaying) return
        recorder?.ended(output.durationMs.takeIf { it > 0 }?.let { it / 1000.0 })
        advance(manual = false)
    }

    /** The loaded file could not be played. */
    fun onOutputFailed() {
        val cur = current ?: return
        failedSongId = cur.id
        isPlaying = false
        output.pause()
        onEvent(PlaybackEvent.Failed(cur))
        publish()
    }

    /**
     * The output changed on its own: [playWhenReady] false means it was paused from outside (audio focus lost for good,
     * headphones unplugged); [suppressed] means it is held back for a while (a call) and will continue by itself.
     */
    fun onOutputChanged(playWhenReady: Boolean, suppressed: Boolean) {
        this.suppressed = suppressed
        if (!playWhenReady && isPlaying) {
            isPlaying = false
            recorder?.paused(output.positionMs / 1000.0)
            saveNow()
        }
        publish()
    }

    /** The output learned something the state shows (the real length of the song). */
    fun onOutputReady() = publish()

    /** The app went to the background: everything is put on disk. */
    fun backgrounded() {
        saveNow()
        recorder?.backgrounded()
    }

    /** The player is going away: the position is saved and the open play ends. */
    fun shutdown() {
        saveNow()
        recorder?.terminating()
    }

    // endregion

    private fun cursor(): QueueCursor? = index?.let { QueueCursor(queue.map { s -> s.id }, it, played, shuffle, repeat) }

    private fun picker(cursor: QueueCursor): (List<Int>, Boolean) -> Int? = { candidates, fresh ->
        val rank = ranker.rank(cursor.ids, pendingCounts(), fresh, cursor.currentID, random)
        ShufflePick.best(candidates, cursor.ids, rank)
    }

    /** Server counts plus the plays this phone has not yet sent, so a song heard a minute ago is already one tier up. */
    private fun pendingCounts(): Map<String, Int>? {
        val server = listenCounts() ?: return null
        val plays = (playLog?.pendingPlays ?: emptyList()) + listOfNotNull(recorder?.openRecord)
        return ShufflePick.merged(server, ShufflePick.localCounts(plays, now()))
    }

    private fun advance(manual: Boolean) {
        val cursor = cursor() ?: return
        val outcome = QueueAdvance.next(cursor, manual, picker(cursor)) ?: return
        played = outcome.played
        apply(outcome.step, remember = true, forward = true, auto = !manual)
    }

    private fun apply(step: QueueStep, remember: Boolean, forward: Boolean, auto: Boolean) {
        when (step) {
            QueueStep.Restart -> {
                seekTo(0)
                resume()
            }
            QueueStep.Rewind -> seekTo(0)
            QueueStep.Pause -> pause()
            is QueueStep.Load -> {
                // No playable song that way: a song that ended by itself stops; a pressed key changes nothing.
                if (!load(step.index, remember, forward) && auto) pause() else publish()
            }
        }
    }

    /**
     * Loads and plays the song at [i]. A song without a file is skipped: the search goes on in the same direction by the
     * queue rules until a song with a file is found. Returns false, changing nothing but [failedSongId], when there is none.
     */
    private fun load(i: Int, remember: Boolean = true, forward: Boolean = true): Boolean {
        if (i !in queue.indices) return false
        val from = current
        val ids = queue.map { it.id }
        var target = i
        var round = played
        var back = history
        val skipped = LinkedHashMap<String, Song>()
        var file = fileFor(ids[target])
        var tries = 0
        while (file == null && tries++ < queue.size * 2) {
            skipped[ids[target]] = queue[target]
            val cursor = QueueCursor(ids, target, round, shuffle, repeat)
            val step = if (forward) {
                val outcome = QueueAdvance.next(cursor, manual = true, pick = picker(cursor)) ?: break
                round = outcome.played
                outcome.step
            } else {
                val outcome = QueueAdvance.previous(cursor, 0.0, back)
                back = outcome.history
                outcome.step
            }
            target = (step as? QueueStep.Load)?.index ?: break
            file = if (ids[target] in skipped) null else fileFor(ids[target])
        }
        if (skipped.isNotEmpty()) report(skipped.values.toList())
        if (file == null) {
            failedSongId = ids[i]
            return false
        }
        played = round
        history = back
        if (remember && shuffle && from != null && target != index) history = history + from.id
        index = target
        install(queue[target], file, 0, play = true)
        return true
    }

    /** Loads the song at [i] paused at [positionMs]; without a file nothing is loaded until Play is pressed. */
    private fun cue(i: Int, positionMs: Long) {
        val song = queue[i]
        val file = fileFor(song.id)
        if (file == null) {
            detach()
            needsItem = true
        } else {
            install(song, file, positionMs, play = false)
        }
    }

    private fun install(song: Song, file: File, positionMs: Long, play: Boolean) {
        failedSongId = null
        needsItem = false
        recorder?.songChanged()
        attachedId = if (song.localOnly == true) null else song.id
        if (play) isPlaying = true
        output.load(song, file, positionMs, play)
    }

    private fun detach() {
        recorder?.songChanged()
        attachedId = null
        needsItem = false
        output.clear()
    }

    private fun report(skipped: List<Song>) = onEvent(PlaybackEvent.SkippedMissing(skipped))

    private fun snapshot() = SavedPlayback(queue.map { it.id }, index ?: 0, queueTags, positionMs / 1000.0)

    private fun saveNow() {
        if (current != null) persistence?.saveNow(snapshot())
    }

    private fun publish() {
        val key = Triple(queue.map { it.id }, index, queueTags)
        if (key != savedKey) {
            savedKey = key
            persistence?.queueChanged(snapshot())
        }
        onState(state)
    }

    companion object {
        /** The songs of [songs] that are not in [queue] yet, each once: what [enqueue] appends. */
        fun fresh(queue: List<Song>, songs: List<Song>): List<Song> {
            val have = queue.mapTo(mutableSetOf()) { it.id }
            return songs.filter { have.add(it.id) }
        }
    }
}
