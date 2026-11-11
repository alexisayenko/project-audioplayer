package com.alexisayenko.audioplayer.android.playback

import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlinx.serialization.Serializable

/**
 * Counts what is actually heard and hands finished plays to the [PlayLog]: the Kotlin port of `PlayRecorder.swift` (IOS-087),
 * checked against the shared `play_recorder_cases.json`. Played time is the sum of forward position steps of at most 1.5 s;
 * a seek or a pause adds nothing; a pause does not end the play; a song change, the end of a song and termination do; plays
 * under 5 s are dropped. The play in progress is kept in `open.json` under [directory], so a killed app loses at most 30 s.
 *
 * Positions are in seconds, [now] is epoch milliseconds. Not thread-safe: use it from one thread.
 */
class PlayRecorder(
    private val log: PlayLog,
    private val directory: File,
    private val now: () -> Long = System::currentTimeMillis,
) {
    @Serializable
    private data class Open(val timestamp: String, val songID: String, val listened: Double, val cont: Boolean)

    @Serializable
    private data class Last(val songID: String, val at: Long)

    @Serializable
    private data class Saved(val open: Open? = null, val last: Last? = null, val savedAt: Long)

    private var open: Open? = null
    private var last: Last? = null
    private var lastPosition: Double? = null
    private var persisted = 0.0

    init {
        recover()
    }

    /** The play in progress as a record, for counting it before it is flushed. */
    val openRecord: PlayRecord?
        get() = open?.let { PlayRecord(it.timestamp, it.songID, it.listened, null) }

    /** Called with every position tick. [songID] is the song that is sounding, or null when nothing countable plays. */
    fun tick(songID: String?, position: Double) {
        if (songID == null || !position.isFinite()) {
            if (open != null && lastPosition != null) persist()
            lastPosition = null
            return
        }
        if (open?.let { it.songID != songID } == true) close()
        if (open == null) begin(songID)
        accumulate(position)
        open?.let { if (it.listened - persisted >= PERSIST_EVERY) persist() }
    }

    /** A seek happened: the jump in position is not listening. */
    fun seeked() {
        lastPosition = null
    }

    /** Playback paused at [position] (null when it was not sounding); the play stays open. */
    fun paused(position: Double?) {
        if (open != null && position != null && position.isFinite()) accumulate(position)
        lastPosition = null
        persist()
        log.flush()
    }

    /** Another song (or none) is loaded: the play ends. */
    fun songChanged() {
        close()
        log.flush()
    }

    /** The song played to its end at [position]: the play ends. */
    fun ended(position: Double?) {
        if (position != null && position.isFinite()) accumulate(position)
        close()
        log.flush()
    }

    /** The app went to the background: keep the open play on disk and try to send what is waiting. */
    fun backgrounded() {
        persist()
        log.flush()
    }

    /** The player is going away: the open play ends and is remembered, so the same song soon after counts as a continuation. */
    fun terminating() {
        open?.let { play ->
            open = null
            lastPosition = null
            enqueue(play)
            if (play.listened >= MIN_PLAY) last = Last(play.songID, now())
        }
        write()
    }

    private fun begin(songID: String) {
        val cont = last?.let { it.songID == songID && now() - it.at <= CONT_WINDOW_MS } ?: false
        last = null
        open = Open(iso(now()), songID, 0.0, cont)
        lastPosition = null
        persisted = 0.0
    }

    private fun accumulate(position: Double) {
        val previous = lastPosition
        lastPosition = position
        val play = open ?: return
        if (previous == null) return
        val step = position - previous
        if (step > 0 && step <= MAX_STEP) open = play.copy(listened = play.listened + step)
    }

    private fun close() {
        val play = open ?: return
        open = null
        lastPosition = null
        persisted = 0.0
        write()
        enqueue(play)
    }

    private fun enqueue(play: Open) {
        if (play.listened < MIN_PLAY) return
        log.add(PlayRecord(play.timestamp, play.songID, play.listened, if (play.cont) true else null))
    }

    private fun persist() {
        val play = open ?: return
        if (play.listened < MIN_PLAY) return
        persisted = play.listened
        write()
    }

    private fun write() {
        val saved = if (open == null && last == null) null else Saved(open, last, now())
        PlayStore.write(Saved.serializer(), saved, FILE, directory)
    }

    private fun recover() {
        val saved = PlayStore.read(Saved.serializer(), FILE, directory) ?: return
        last = saved.last
        saved.open?.let { left ->
            enqueue(left)
            if (left.listened >= MIN_PLAY) last = Last(left.songID, saved.savedAt)
        }
        write()
    }

    companion object {
        /** Plays shorter than this, in seconds, are dropped. */
        const val MIN_PLAY = PlayLog.MIN_PLAY

        /** A position step longer than this, in seconds, is a jump, not listening. */
        const val MAX_STEP = 1.5

        /** The same song started again within this time of a terminated play is a continuation. */
        const val CONT_WINDOW_MS = 600_000L

        /** The open play is written to disk every this many heard seconds. */
        const val PERSIST_EVERY = 30.0

        private const val FILE = "open.json"
        private val FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

        /** ISO 8601 in UTC with milliseconds, as iOS writes it. */
        internal fun iso(epochMs: Long): String = FORMAT.format(Instant.ofEpochMilli(epochMs))
    }
}
