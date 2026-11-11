package com.alexisayenko.audioplayer.android.playback

import androidx.media3.common.MediaMetadata
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Mirrors `ios/Tests/NowPlayingTests.swift`: what the lock screen shows. The elapsed time and rate cases have no
 * counterpart: on Android the session takes them from the player.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class NowPlayingTest {
    private fun song(album: String? = null) = Song("aaaaaaaaaaa", "Song", artist = "Artist", album = album)

    @Test
    fun infoCarriesTheShownText() {
        val shown = NowPlaying.metadata(song(), title = "Shown", artist = "Shown Artist")
        assertEquals("Shown", shown.title)
        assertEquals("Shown Artist", shown.artist)
        val plain = NowPlaying.metadata(song())
        assertEquals("Song", plain.title)
        assertEquals("Artist", plain.artist)
        assertEquals(MediaMetadata.MEDIA_TYPE_MUSIC, plain.mediaType)
    }

    @Test
    fun albumAppearsOnlyWhenNotEmpty() {
        assertEquals("LP", NowPlaying.metadata(song(album = "LP")).albumTitle)
        assertNull(NowPlaying.metadata(song(album = "")).albumTitle)
        assertNull(NowPlaying.metadata(song()).albumTitle)
        assertNull(NowPlaying.metadata(song()).artworkUri)
    }

    @Test
    fun theCoverIsALocalFile() {
        val cover = File("/data/covers/aaaaaaaaaaa.jpg")
        assertEquals("file:///data/covers/aaaaaaaaaaa.jpg", NowPlaying.metadata(song(), cover = cover).artworkUri.toString())
    }

    @Test
    fun theMediaItemIsAlwaysTheFileOnThePhone() {
        val item = NowPlaying.mediaItem(song(album = "LP"), File("/data/audio/Artist - Song.m4a"))
        assertEquals("aaaaaaaaaaa", item.mediaId)
        assertEquals("file", item.localConfiguration?.uri?.scheme)
        assertEquals("/data/audio/Artist - Song.m4a", item.localConfiguration?.uri?.path)
        assertEquals("LP", item.mediaMetadata.albumTitle)
    }
}
