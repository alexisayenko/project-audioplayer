package com.alexisayenko.audioplayer.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors `ios/Tests/QueueAdvanceTests.swift` case for case. */
class QueueAdvanceTest {
    private val ids = listOf("a", "b", "c")

    private fun cursor(index: Int, played: List<String> = emptyList(), shuffle: Boolean = false, repeatMode: RepeatMode = RepeatMode.Off) =
        QueueCursor(ids, index, played, shuffle, repeatMode)

    private fun next(c: QueueCursor, manual: Boolean = true, pick: Int? = null): AdvanceOutcome? =
        QueueAdvance.next(c, manual) { candidates, _ -> pick ?: candidates.firstOrNull() }

    @Test
    fun plainOrderWalksTheQueueAndStopsAtTheEnd() {
        assertEquals(QueueStep.Load(1), next(cursor(0))?.step)
        assertEquals(QueueStep.Load(2), next(cursor(1))?.step)
        assertEquals(QueueStep.Pause, next(cursor(2))?.step)
    }

    @Test
    fun repeatAllWrapsToTheFirstSong() {
        assertEquals(QueueStep.Load(0), next(cursor(2, repeatMode = RepeatMode.All))?.step)
    }

    @Test
    fun repeatOneRestartsOnlyWhenTheSongEndsOnItsOwn() {
        val c = cursor(1, repeatMode = RepeatMode.One)
        assertEquals(AdvanceOutcome(QueueStep.Restart, emptyList()), next(c, manual = false))
        assertEquals(QueueStep.Load(2), next(c, manual = true)?.step)
    }

    @Test
    fun advanceRecordsTheCurrentSongAsPlayed() {
        assertEquals(listOf("a"), next(cursor(0))?.played)
        assertEquals(listOf("a", "b"), next(cursor(1, played = listOf("a", "b")))?.played)
    }

    @Test
    fun noCurrentSongIsNoOutcome() {
        assertNull(next(cursor(5)))
    }

    @Test
    fun shuffleOffersOnlySongsNotYetPlayed() {
        var offered = emptyList<Int>()
        val outcome = QueueAdvance.next(cursor(0, played = listOf("a"), shuffle = true), manual = true) { candidates, fresh ->
            offered = candidates
            assertFalse(fresh)
            candidates.last()
        }
        assertEquals(listOf(1, 2), offered)
        assertEquals(AdvanceOutcome(QueueStep.Load(2), listOf("a")), outcome)
    }

    @Test
    fun shuffleFallsBackToTheFirstCandidateWhenNothingIsPicked() {
        val outcome = QueueAdvance.next(cursor(0, shuffle = true), manual = true) { _, _ -> null }
        assertEquals(QueueStep.Load(1), outcome?.step)
    }

    @Test
    fun shuffleRoundEndPausesWithoutRepeatAndKeepsPlayed() {
        val outcome = next(cursor(2, played = listOf("a", "b"), shuffle = true))
        assertEquals(AdvanceOutcome(QueueStep.Pause, listOf("a", "b")), outcome)
    }

    @Test
    fun shuffleRoundEndWithRepeatAllStartsAFreshRoundAwayFromTheCurrentSong() {
        var freshSeen = false
        var offered = emptyList<Int>()
        val c = cursor(2, played = listOf("a", "b"), shuffle = true, repeatMode = RepeatMode.All)
        val outcome = QueueAdvance.next(c, manual = true) { candidates, fresh ->
            freshSeen = fresh
            offered = candidates
            candidates.first()
        }
        assertTrue(freshSeen)
        assertEquals(listOf(0, 1), offered)
        assertEquals(AdvanceOutcome(QueueStep.Load(0), listOf("c")), outcome)
    }

    @Test
    fun shuffleRepeatAllWithOneSongRestartsIt() {
        val single = QueueCursor(listOf("a"), 0, emptyList(), shuffle = true, repeatMode = RepeatMode.All)
        assertEquals(AdvanceOutcome(QueueStep.Restart, listOf("a")), next(single))
    }

    @Test
    fun previousRewindsPastThreeSeconds() {
        assertEquals(
            StepBackOutcome(QueueStep.Rewind, listOf("x")),
            QueueAdvance.previous(cursor(1), position = 3.5, history = listOf("x")),
        )
        // The boundary: exactly 3 s still steps back.
        assertEquals(QueueStep.Load(0), QueueAdvance.previous(cursor(1), position = 3.0, history = emptyList()).step)
    }

    @Test
    fun previousStepsBackInPlainOrderAndRewindsAtTheStart() {
        assertEquals(QueueStep.Load(1), QueueAdvance.previous(cursor(2), position = 1.0, history = emptyList()).step)
        assertEquals(QueueStep.Rewind, QueueAdvance.previous(cursor(0), position = 1.0, history = emptyList()).step)
    }

    @Test
    fun previousUnderShuffleFollowsHistoryAndSkipsStaleEntries() {
        val c = cursor(1, shuffle = true)
        assertEquals(StepBackOutcome(QueueStep.Load(2), emptyList()), QueueAdvance.previous(c, 0.0, listOf("c", "gone", "b")))
        assertEquals(StepBackOutcome(QueueStep.Load(0), emptyList()), QueueAdvance.previous(c, 0.0, listOf("a", "gone")))
        assertEquals(StepBackOutcome(QueueStep.Rewind, emptyList()), QueueAdvance.previous(c, 0.0, listOf("gone")))
    }

    @Test
    fun hasNext() {
        assertTrue(QueueAdvance.hasNext(cursor(1)))
        assertFalse(QueueAdvance.hasNext(cursor(2)))
        assertTrue(QueueAdvance.hasNext(cursor(2, repeatMode = RepeatMode.All)))
        assertTrue(QueueAdvance.hasNext(cursor(2, played = listOf("a"), shuffle = true)))
        assertFalse(QueueAdvance.hasNext(cursor(2, played = listOf("a", "b"), shuffle = true)))
    }

    @Test
    fun moveFollowsOnMoveSemantics() {
        val items = listOf("a", "b", "c", "d")
        assertEquals(listOf("b", "c", "a", "d"), QueueEdit.moved(items, listOf(0), 3))
        assertEquals(listOf("d", "a", "b", "c"), QueueEdit.moved(items, listOf(3), 0))
        assertEquals(listOf("c", "d", "a", "b"), QueueEdit.moved(items, listOf(0, 1), 4))
        assertEquals(items, QueueEdit.moved(items, listOf(1), 1))
        assertEquals(items, QueueEdit.moved(items, listOf(9), 0))
    }

    @Test
    fun movedToPutsOneRowAtItsFinalPosition() {
        val items = listOf("a", "b", "c", "d")
        assertEquals(listOf("b", "c", "a", "d"), QueueEdit.movedTo(items, 0, 2))
        assertEquals(listOf("d", "a", "b", "c"), QueueEdit.movedTo(items, 3, 0))
        assertEquals(items, QueueEdit.movedTo(items, 1, 1))
        assertEquals(items, QueueEdit.movedTo(items, 9, 0))
        assertEquals(items, QueueEdit.movedTo(items, 0, 4))
    }

    @Test
    fun orphansAreSongsQueuedOnlyThroughTheTag() {
        val queue = listOf("a", "b", "c", "d")
        val via = mapOf("a" to setOf("rock"), "b" to setOf("rock", "pop"), "c" to setOf("rock"), "d" to setOf("pop"))
        assertEquals(listOf(0), QueueEdit.orphans(queue, via, "rock", manual = setOf("c"), current = null))
        assertEquals(listOf(2), QueueEdit.orphans(queue, via, "rock", manual = emptySet(), current = "a"))
    }

    @Test
    fun repeatCyclesOffAllOneAndKeepsTheStoredNames() {
        assertEquals(RepeatMode.All, RepeatMode.Off.next)
        assertEquals(RepeatMode.One, RepeatMode.All.next)
        assertEquals(RepeatMode.Off, RepeatMode.One.next)
        assertEquals(listOf("off", "all", "one"), RepeatMode.entries.map { it.rawValue })
        assertEquals(RepeatMode.One, repeatModeOf("one"))
        assertEquals(RepeatMode.Off, repeatModeOf("nonsense"))
        assertEquals(RepeatMode.Off, repeatModeOf(null))
    }
}
