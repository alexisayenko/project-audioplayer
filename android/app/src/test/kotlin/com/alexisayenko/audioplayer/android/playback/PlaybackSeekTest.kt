package com.alexisayenko.audioplayer.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Mirrors `ios/Tests/PlaybackSeekTests.swift`. */
class PlaybackSeekTest {
    @Test
    fun tapSkipsFiveSecondsTowardTappedSide() {
        assertEquals(45.0, PlaybackSeek.tapTarget(50.0, 200.0, 20.0))
        assertEquals(55.0, PlaybackSeek.tapTarget(50.0, 200.0, 80.0))
        assertNull(PlaybackSeek.tapTarget(50.0, 200.0, 50.0))
    }

    @Test
    fun tapSkipClampsAtSongBounds() {
        assertEquals(0.0, PlaybackSeek.tapTarget(3.0, 200.0, 0.0))
        assertEquals(200.0, PlaybackSeek.tapTarget(198.0, 200.0, 200.0))
    }

    @Test
    fun invalidDurationOrPositionDoesNotSeek() {
        assertNull(PlaybackSeek.tapTarget(2.0, 0.0, 0.0))
        assertNull(PlaybackSeek.tapTarget(2.0, 30.0, Double.POSITIVE_INFINITY))
    }
}
