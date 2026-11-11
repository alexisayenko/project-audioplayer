package com.alexisayenko.audioplayer.android.playback

import java.time.Instant
import java.time.OffsetDateTime
import kotlin.random.Random

/**
 * Shuffle that favours less-played songs: the Kotlin port of `ShufflePick.swift` (IOS-105, AND-063). The round order is the
 * songs shuffled, then stable-sorted by their recent play count, so the lowest tier plays first and each tier is random.
 * Without counts the order is a plain uniform shuffle.
 */
object ShufflePick {
    /** A play not yet sent to the server counts once it is at least this long, in seconds. */
    const val MIN_LOCAL_PLAY = 5.0

    /** Only plays of the last 30 days count, in milliseconds. */
    const val WINDOW_MS = 30L * 86_400_000L

    /** Plays not yet flushed to the server that count as one play each: at least 5 s and not older than 30 days. */
    fun localCounts(plays: List<PlayRecord>, nowMs: Long = System.currentTimeMillis()): Map<String, Int> {
        val out = mutableMapOf<String, Int>()
        for (play in plays) {
            if (play.listened < MIN_LOCAL_PLAY) continue
            val at = parseTimestamp(play.timestamp) ?: continue
            if (nowMs - at > WINDOW_MS) continue
            out[play.songID] = (out[play.songID] ?: 0) + 1
        }
        return out
    }

    /** Server counts plus the local ones, added per song. */
    fun merged(server: Map<String, Int>, local: Map<String, Int>): Map<String, Int> {
        val out = server.toMutableMap()
        for ((id, n) in local) out[id] = (out[id] ?: 0) + n
        return out
    }

    /** Fisher-Yates, then a stable sort by count when counts are known; the song just played ([last]) is not put first again. */
    fun order(ids: List<String>, counts: Map<String, Int>?, last: String? = null, random: Random): List<String> {
        val order = ids.toMutableList()
        for (i in order.lastIndex downTo 1) {
            val j = random.nextInt(i + 1)
            val held = order[i]
            order[i] = order[j]
            order[j] = held
        }
        if (counts != null) order.sortBy { counts[it] ?: 0 } // sortBy is stable, so ties keep the shuffled order
        if (last != null && order.size > 1 && order[0] == last) {
            order[0] = order[1]
            order[1] = last
        }
        return order
    }

    /** The index in [ids] of a song from the lowest-count tier, chosen at random: where "Play all" starts under shuffle. */
    fun firstIndex(ids: List<String>, counts: Map<String, Int>?, random: Random): Int? {
        val first = order(ids, counts, random = random).firstOrNull() ?: return null
        return ids.indexOf(first)
    }

    /** Of the candidate positions in [ids], the one ranked best in [rank]. */
    fun best(candidates: List<Int>, ids: List<String>, rank: Map<String, Int>): Int? =
        candidates.minByOrNull { rank[ids[it]] ?: Int.MAX_VALUE }

    /** Epoch milliseconds of an ISO 8601 timestamp, with or without fractional seconds; null when it is not a date. */
    internal fun parseTimestamp(text: String): Long? =
        runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
}

/**
 * Keeps the round order between Next presses (the Swift `ShuffleRanker`): rebuilt when the queue changes, when asked for a
 * fresh round, and when counts first arrive after an unweighted start; not after each play.
 */
class ShuffleRanker {
    private var signature: String? = null
    private var rank: Map<String, Int> = emptyMap()
    private var weighted = false

    /** The position of every id in the current round order; lower plays earlier. */
    fun rank(
        ids: List<String>,
        counts: Map<String, Int>?,
        fresh: Boolean = false,
        last: String? = null,
        random: Random,
    ): Map<String, Int> {
        val sig = ids.joinToString("\u0000")
        if (!fresh && signature == sig && (weighted || counts == null)) return rank
        signature = sig
        weighted = counts != null
        val built = mutableMapOf<String, Int>()
        ShufflePick.order(ids, counts, last, random).forEachIndexed { i, id -> if (id !in built) built[id] = i }
        rank = built
        return built
    }
}
