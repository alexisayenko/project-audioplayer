package com.alexisayenko.audioplayer.android.playback

import java.time.Instant
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirrors `ios/Tests/ShufflePickTests.swift` case for case, with a seeded [Random], plus the distribution over many draws
 * (AND-100). The iOS case about reading the server's 30-day counts belongs to the listening store, not to this package.
 */
class ShufflePickTest {
    private val ids = listOf("a", "b", "c", "d", "e", "f")

    @Test
    fun orderIsAPermutation() {
        val order = ShufflePick.order(ids, null, random = Random(1))
        assertEquals(ids, order.sorted())
    }

    @Test
    fun lessPlayedSongsComeFirst() {
        val counts = mapOf("a" to 3, "b" to 0, "c" to 1, "d" to 0, "e" to 3, "f" to 1)
        for (seed in 1..20) {
            val tiers = ShufflePick.order(ids, counts, random = Random(seed)).map { counts[it] ?: 0 }
            assertEquals("seed $seed", tiers.sorted(), tiers)
        }
    }

    @Test
    fun songsWithoutACountAreTheLowestTier() {
        val order = ShufflePick.order(ids, mapOf("a" to 2, "b" to 2, "c" to 2), random = Random(7))
        assertEquals(setOf("d", "e", "f"), order.take(3).toSet())
    }

    @Test
    fun tiesAreShuffledNotFixed() {
        val counts = ids.associateWith { 0 }
        val firsts = (1..40).map { ShufflePick.order(ids, counts, random = Random(it))[0] }.toSet()
        assertTrue(firsts.size > 2)
    }

    @Test
    fun noCountsIsUniformNotSorted() {
        val seen = (1..10).map { ShufflePick.order(ids, null, random = Random(it)) }.toSet()
        assertTrue(seen.size > 1)
    }

    @Test
    fun theSongJustPlayedIsNotFirstAgain() {
        for (seed in 1..30) {
            val order = ShufflePick.order(ids, ids.associateWith { 0 }, last = "a", random = Random(seed))
            assertNotEquals("seed $seed", "a", order[0])
        }
    }

    @Test
    fun firstIndexIsFromTheLowestTier() {
        val counts = mapOf("a" to 5, "b" to 5, "c" to 0, "d" to 5, "e" to 5, "f" to 5)
        for (seed in 1..10) assertEquals(2, ShufflePick.firstIndex(ids, counts, Random(seed)))
        assertNull(ShufflePick.firstIndex(emptyList(), null, Random(1)))
    }

    @Test
    fun bestPicksTheLowestRankedCandidate() {
        val rank = mapOf("a" to 4, "b" to 0, "c" to 2, "d" to 1, "e" to 3, "f" to 5)
        assertEquals(2, ShufflePick.best(listOf(0, 2, 4), ids, rank))
        assertEquals(1, ShufflePick.best(listOf(1, 3), ids, rank))
        assertNull(ShufflePick.best(emptyList(), ids, rank))
    }

    @Test
    fun roundPlaysTiersInOrderUnderRepeatedNext() {
        val counts = mapOf("a" to 2, "b" to 0, "c" to 1, "d" to 0, "e" to 2, "f" to 1)
        val random = Random(3)
        val ranker = ShuffleRanker()
        val left = ids.indices.toMutableList()
        val tiers = mutableListOf<Int>()
        while (left.isNotEmpty()) {
            val rank = ranker.rank(ids, counts, random = random)
            val pick = ShufflePick.best(left, ids, rank)!!
            tiers += counts[ids[pick]] ?: 0
            left.remove(pick)
        }
        assertEquals(listOf(0, 0, 1, 1, 2, 2), tiers)
    }

    @Test
    fun rankerKeepsTheRoundOrderUntilTheQueueChanges() {
        val random = Random(9)
        val ranker = ShuffleRanker()
        val counts = mapOf("a" to 0)
        val first = ranker.rank(ids, counts, random = random)
        assertEquals(first, ranker.rank(ids, counts, random = random))
        assertEquals(first, ranker.rank(ids, mapOf("a" to 9), random = random))
        val changed = ranker.rank(ids + "g", counts, random = random)
        assertEquals(7, changed.size)
    }

    @Test
    fun rankerRebuildsWhenCountsFirstArrive() {
        val random = Random(5)
        val ranker = ShuffleRanker()
        ranker.rank(ids, null, random = random)
        val weighted = ranker.rank(ids, mapOf("a" to 4, "b" to 4, "c" to 4, "d" to 4, "e" to 4), random = random)
        assertEquals(0, weighted["f"])
    }

    @Test
    fun freshRoundRebuilds() {
        val counts = mapOf("a" to 1)
        val ranker = ShuffleRanker()
        val seen = (1..10).map { ranker.rank(ids, counts, fresh = true, random = Random(it)) }.toSet()
        assertTrue(seen.size > 1)
    }

    @Test
    fun localCountsTakeRecentPlaysOfAtLeastFiveSeconds() {
        val now = 1_800_000_000_000L
        val stamp = { ageSeconds: Long -> Instant.ofEpochMilli(now - ageSeconds * 1000).toString() }
        val plays = listOf(
            PlayRecord(stamp(60), "a", 30.0),
            PlayRecord(stamp(120), "a", 5.0),
            PlayRecord(stamp(60), "b", 4.9),
            PlayRecord(stamp(31L * 86_400), "c", 90.0),
            PlayRecord("not a date", "d", 90.0),
        )
        assertEquals(mapOf("a" to 2), ShufflePick.localCounts(plays, now))
    }

    @Test
    fun localCountsReadTheTimestampsTheRecorderWrites() {
        val now = 1_800_000_000_000L
        val plays = listOf(PlayRecord(PlayRecorder.iso(now - 1000), "a", 9.0), PlayRecord("2027-01-15T08:00:00+02:00", "b", 9.0))
        assertEquals(mapOf("a" to 1, "b" to 1), ShufflePick.localCounts(plays, now))
    }

    @Test
    fun mergeAddsLocalToServerCounts() {
        assertEquals(mapOf("a" to 3, "b" to 0, "c" to 1), ShufflePick.merged(mapOf("a" to 1, "b" to 0), mapOf("a" to 2, "c" to 1)))
    }

    @Test
    fun withoutCountsEverySongStartsAboutEquallyOften() {
        val random = Random(2026)
        val draws = 12_000
        val firsts = mutableMapOf<String, Int>()
        repeat(draws) {
            val first = ShufflePick.order(ids, null, random = random)[0]
            firsts[first] = (firsts[first] ?: 0) + 1
        }
        val expected = draws / ids.size
        for (id in ids) {
            val n = firsts[id] ?: 0
            assertTrue("$id started $n times of $draws", n in (expected * 85 / 100)..(expected * 115 / 100))
        }
    }

    @Test
    fun withCountsOnlyTheLeastPlayedStartAndEachAboutEquallyOften() {
        val counts = mapOf("a" to 4, "b" to 0, "c" to 1, "d" to 0, "e" to 9, "f" to 0)
        val random = Random(2027)
        val draws = 9_000
        val firsts = mutableMapOf<String, Int>()
        val lasts = mutableMapOf<String, Int>()
        repeat(draws) {
            val order = ShufflePick.order(ids, counts, random = random)
            firsts[order.first()] = (firsts[order.first()] ?: 0) + 1
            lasts[order.last()] = (lasts[order.last()] ?: 0) + 1
            val picked = ShufflePick.firstIndex(ids, counts, random)!!
            assertEquals(0, counts[ids[picked]])
        }
        assertEquals(setOf("b", "d", "f"), firsts.keys)
        assertEquals(mapOf("e" to draws), lasts)
        val expected = draws / 3
        for ((id, n) in firsts) assertTrue("$id started $n times of $draws", n in (expected * 85 / 100)..(expected * 115 / 100))
    }

    @Test
    fun everyPositionOfAnUnweightedShuffleIsUniform() {
        val random = Random(77)
        val draws = 12_000
        val at = Array(ids.size) { IntArray(ids.size) }
        repeat(draws) { ShufflePick.order(ids, null, random = random).forEachIndexed { place, id -> at[place][ids.indexOf(id)]++ } }
        val expected = draws / ids.size
        for (place in ids.indices) for (n in at[place]) assertTrue("place $place: $n", n in (expected * 85 / 100)..(expected * 115 / 100))
    }
}
