package com.alexisayenko.audioplayer.android.playback

import com.alexisayenko.audioplayer.android.model.Song
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The in-memory controller the previews and UI tests use. */
class FakePlayerControllerTest {
    private val songs = listOf("a", "b", "c").map { Song(it, it.uppercase(), artist = "Artist", duration = 100.0) }

    @Test
    fun startsEmptyAndIgnoresTransportWithoutASong() {
        val player = FakePlayerController()
        player.toggle()
        player.next()
        player.previous()
        player.seekTo(5_000)
        assertEquals(PlayerState(), player.state.value)
        assertNull(player.state.value.current)
    }

    @Test
    fun canBeBuiltWithAQueueForAPreview() {
        val paused = FakePlayerController(songs, startIndex = 1)
        assertEquals(songs[1], paused.state.value.current)
        assertFalse(paused.state.value.isPlaying)
        assertEquals(100_000L, paused.state.value.durationMs)
        assertTrue(FakePlayerController(songs, playing = true).state.value.isPlaying)
    }

    @Test
    fun playTogglePauseResume() {
        val player = FakePlayerController()
        player.play(songs, 0)
        assertTrue(player.state.value.isPlaying)
        player.toggle()
        assertFalse(player.state.value.isPlaying)
        player.resume()
        assertTrue(player.state.value.isPlaying)
        player.pause()
        assertFalse(player.state.value.isPlaying)
    }

    @Test
    fun timeMovesOnlyWhenAskedAndOnlyWhilePlaying() {
        val player = FakePlayerController(songs, playing = true)
        assertEquals(0L, player.state.value.positionMs)
        player.advanceBy(30_000)
        assertEquals(30_000L, player.state.value.positionMs)
        player.pause()
        player.advanceBy(30_000)
        assertEquals(30_000L, player.state.value.positionMs)
    }

    @Test
    fun theEndOfASongAdvancesAndTheEndOfTheQueueStops() {
        val player = FakePlayerController(songs, playing = true)
        player.advanceBy(100_000)
        assertEquals(1, player.state.value.index)
        assertEquals(0L, player.state.value.positionMs)
        player.advanceBy(100_000)
        player.advanceBy(100_000)
        assertEquals(2, player.state.value.index)
        assertFalse(player.state.value.isPlaying)
    }

    @Test
    fun seekSkipNextPreviousAndJump() {
        val player = FakePlayerController(songs, playing = true)
        player.seekTo(50_000)
        player.skipBy(-10_000)
        assertEquals(40_000L, player.state.value.positionMs)
        player.previous() // past 3 s: back to the start of the song
        assertEquals(0 to 0L, player.state.value.index to player.state.value.positionMs)
        player.next()
        assertEquals(1, player.state.value.index)
        player.previous()
        assertEquals(0, player.state.value.index)
        player.jumpTo(2)
        assertEquals(songs[2], player.state.value.current)
        assertFalse(player.state.value.hasNext)
    }

    @Test
    fun queueEdits() {
        val player = FakePlayerController(songs.take(1), playing = true)
        assertEquals(2, player.enqueue(songs))
        assertEquals(0, player.enqueue(songs))
        player.playNext(songs[2])
        assertEquals(listOf("a", "c", "b"), player.state.value.queue.map { it.id })
        player.moveQueueItem(2, 0)
        assertEquals(listOf("b", "a", "c"), player.state.value.queue.map { it.id })
        assertEquals(1, player.state.value.index)
        player.removeFromQueue(0)
        assertEquals(listOf("a", "c"), player.state.value.queue.map { it.id })
        player.playNow(songs[1])
        assertEquals(listOf("a", "b", "c"), player.state.value.queue.map { it.id })
        assertEquals(songs[1], player.state.value.current)
        player.clearQueue()
        assertEquals(listOf(songs[1]), player.state.value.queue)
        assertEquals(0, player.state.value.index)
    }

    @Test
    fun shuffleAndRepeatShowInTheState() {
        val player = FakePlayerController(songs, playing = true)
        player.setShuffle(true)
        player.setRepeat(RepeatMode.One)
        assertTrue(player.state.value.shuffle)
        assertEquals(RepeatMode.One, player.state.value.repeat)
        player.advanceBy(100_000)
        assertEquals(0, player.state.value.index) // repeat one: the same song again
        assertTrue(player.state.value.isPlaying)
        assertEquals(0L, player.state.value.positionMs)
    }

    @Test
    fun playAllStartsAtTheFirstSong() {
        val player = FakePlayerController()
        player.playAll(songs)
        assertEquals(0, player.state.value.index)
        assertTrue(player.state.value.isPlaying)
    }
}
