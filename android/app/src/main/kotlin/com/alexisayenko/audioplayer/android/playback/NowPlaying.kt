package com.alexisayenko.audioplayer.android.playback

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File

/**
 * What the media notification and the lock screen show for a song (AND-061): the counterpart of `NowPlaying.swift`.
 * Elapsed time and rate are not here: on Android the session reads them from the player itself.
 */
object NowPlaying {
    /** Title, artist, the album when it is not empty, and the cover when a local file is given. */
    fun metadata(song: Song, title: String = song.title, artist: String = song.artist, cover: File? = null): MediaMetadata {
        val builder = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
            .setIsPlayable(true)
        song.album?.takeIf { it.isNotEmpty() }?.let(builder::setAlbumTitle)
        cover?.let { builder.setArtworkUri(Uri.fromFile(it)) }
        return builder.build()
    }

    /** The media item of a song: always the `file://` URI of its audio on this phone, never a server address (AND-001, AND-063). */
    fun mediaItem(song: Song, file: File, cover: File? = null): MediaItem =
        MediaItem.Builder()
            .setMediaId(song.id)
            .setUri(Uri.fromFile(file))
            .setMediaMetadata(metadata(song, cover = cover))
            .build()
}
