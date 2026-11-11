package com.alexisayenko.audioplayer.android.playback

/** The mode the Repeat key switches to next: off, whole list, one song, off (the Swift `PlaybackRepeat.next`). */
val RepeatMode.next: RepeatMode
    get() = when (this) {
        RepeatMode.Off -> RepeatMode.All
        RepeatMode.All -> RepeatMode.One
        RepeatMode.One -> RepeatMode.Off
    }

/** The stored name of a repeat mode: `off`, `all` or `one`, as iOS and the web keep it. */
val RepeatMode.rawValue: String
    get() = when (this) {
        RepeatMode.Off -> "off"
        RepeatMode.All -> "all"
        RepeatMode.One -> "one"
    }

/** The repeat mode stored as [raw]; anything unknown is off. */
fun repeatModeOf(raw: String?): RepeatMode = RepeatMode.entries.firstOrNull { it.rawValue == raw } ?: RepeatMode.Off

/** What the player does after an advance or a step back (the Swift `QueueStep`). */
sealed interface QueueStep {
    /** Start the current song again and keep playing. */
    data object Restart : QueueStep

    /** Go back to the start of the current song. */
    data object Rewind : QueueStep

    /** Stop at the end of the queue. */
    data object Pause : QueueStep

    /** Load the song at [index] of the queue. */
    data class Load(val index: Int) : QueueStep
}

/** The queue as the advance rules see it: song ids in queue order, the playing position, the songs already played this round. */
data class QueueCursor(
    val ids: List<String>,
    val index: Int,
    val played: List<String>,
    val shuffle: Boolean,
    val repeatMode: RepeatMode,
) {
    val currentID: String? get() = ids.getOrNull(index)
}

/** The outcome of Next: the step and the songs played this round. */
data class AdvanceOutcome(val step: QueueStep, val played: List<String>)

/** The outcome of Previous: the step and what is left of the shuffle history. */
data class StepBackOutcome(val step: QueueStep, val history: List<String>)

/**
 * The rules for Next, Previous and "is there a next song", apart from the player: the Kotlin port of `QueueAdvance.swift`.
 * Pure, so they run in JVM unit tests.
 */
object QueueAdvance {
    /** Next. [pick] chooses among the candidate positions under shuffle; its `fresh` flag says a new shuffle round starts. */
    fun next(cursor: QueueCursor, manual: Boolean, pick: (candidates: List<Int>, fresh: Boolean) -> Int?): AdvanceOutcome? {
        val current = cursor.currentID ?: return null
        val index = cursor.index
        if (cursor.repeatMode == RepeatMode.One && !manual) return AdvanceOutcome(QueueStep.Restart, cursor.played)
        var seen = if (current in cursor.played) cursor.played else cursor.played + current
        if (!cursor.shuffle) {
            val step = when {
                index + 1 < cursor.ids.size -> QueueStep.Load(index + 1)
                cursor.repeatMode == RepeatMode.All -> QueueStep.Load(0)
                else -> QueueStep.Pause
            }
            return AdvanceOutcome(step, seen)
        }
        var candidates = cursor.ids.indices.filter { cursor.ids[it] !in seen }
        var fresh = false
        if (candidates.isEmpty()) {
            if (cursor.repeatMode != RepeatMode.All) return AdvanceOutcome(QueueStep.Pause, cursor.played)
            seen = listOf(current)
            fresh = true
            candidates = cursor.ids.indices.filter { it != index }
            if (candidates.isEmpty()) return AdvanceOutcome(QueueStep.Restart, seen)
        }
        return AdvanceOutcome(QueueStep.Load(pick(candidates, fresh) ?: candidates[0]), seen)
    }

    /** Previous: past 3 s it rewinds; under shuffle it follows [history], otherwise it steps back one row. */
    fun previous(cursor: QueueCursor, position: Double, history: List<String>): StepBackOutcome {
        if (position > 3) return StepBackOutcome(QueueStep.Rewind, history)
        if (cursor.shuffle) {
            val rest = history.toMutableList()
            while (rest.isNotEmpty()) {
                val id = rest.removeAt(rest.lastIndex)
                val at = cursor.ids.indexOf(id)
                if (at >= 0 && at != cursor.index) return StepBackOutcome(QueueStep.Load(at), rest)
            }
            return StepBackOutcome(QueueStep.Rewind, rest)
        }
        return StepBackOutcome(if (cursor.index == 0) QueueStep.Rewind else QueueStep.Load(cursor.index - 1), history)
    }

    /** Whether Next would go somewhere. */
    fun hasNext(cursor: QueueCursor): Boolean {
        if (cursor.repeatMode == RepeatMode.All) return cursor.ids.isNotEmpty()
        if (cursor.shuffle) return cursor.ids.any { it !in cursor.played && it != cursor.currentID }
        return cursor.index + 1 < cursor.ids.size
    }
}

/** Queue edits that do not need the player (the Swift `QueueEdit`). */
object QueueEdit {
    /** Moves the rows at [from] together; [to] is an insertion offset in the old order (SwiftUI `onMove` semantics). */
    fun <T> moved(items: List<T>, from: Collection<Int>, to: Int): List<T> {
        val source = from.filter { it in items.indices }.distinct().sorted()
        if (source.isEmpty()) return items
        val picked = source.map { items[it] }
        val rest = items.toMutableList()
        for (i in source.asReversed()) rest.removeAt(i)
        val target = (to - source.count { it < to }).coerceIn(0, rest.size)
        rest.addAll(target, picked)
        return rest
    }

    /** Moves one row from position [from] to final position [to]; the same list when either is out of range. */
    fun <T> movedTo(items: List<T>, from: Int, to: Int): List<T> {
        if (from !in items.indices || to !in items.indices || from == to) return items
        val rest = items.toMutableList()
        rest.add(to, rest.removeAt(from))
        return rest
    }

    /** Positions of songs that were queued only through [key] (a lower-case tag) and may leave with it. */
    fun orphans(ids: List<String>, viaTags: Map<String, Set<String>>, key: String, manual: Set<String>, current: String?): List<Int> =
        ids.indices.filter { i ->
            val id = ids[i]
            val tags = viaTags[id]
            tags != null && key in tags && id !in manual && id != current && (tags - key).isEmpty()
        }
}
