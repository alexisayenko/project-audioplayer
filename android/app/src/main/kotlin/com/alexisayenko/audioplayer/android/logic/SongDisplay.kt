package com.alexisayenko.audioplayer.android.logic

import com.alexisayenko.audioplayer.android.model.Song

/**
 * The one place that turns a song into the lines people read: every row, the song sheet, Now playing and the media
 * session take their text from here, so a name or a year never reads differently in two places (AND-020).
 *
 * Ports what the iPhone screens show: `LibrarySongRow`, `SongRow` and `PlaybackView` show `track.title` over
 * `track.librarySubtitle` (`ios/Sources/LibraryMatching.swift`), `SongDetailsView` adds a version line.
 * The Mac-only `SongName` rules (remixer in brackets after the title) are not part of the iPhone app and not ported.
 */
object SongDisplay {
    /** The separator between artist and year. */
    const val DOT = " · "

    /** First line: the song's title as stored; the iPhone app adds nothing to it. */
    fun titleLine(song: Song): String = song.title

    /**
     * The artist text alone: "A & B feat. C with D" from the structured credits, else the plain `artist` field.
     * Use it where the year does not fit (album rows, the media session's artist).
     */
    fun artistLine(song: Song): String = song.libraryArtist

    /** The year the song is shown with: a remix's or version's own year, a remaster's original year; null when unknown. */
    fun year(song: Song): Int? = song.libraryYear

    /** Second line: "Artist · year"; either part is left out when missing, and the line may be empty. */
    fun subtitleLine(song: Song): String = joined(song, DOT)

    /** [subtitleLine] with no-break spaces around the dot, for layouts where the line may wrap (large text sizes). */
    fun subtitleLineUnbroken(song: Song): String = joined(song, " · ")

    /** The version line of the song sheet: the version's name ("Night Mix"), else its kind ("Remix"), else "". */
    fun versionLine(song: Song): String = song.version?.name ?: song.version?.type?.let(::capitalizeWords) ?: ""

    /**
     * "Artist - Title" on one line (just the title without an artist), for share text and one-line labels.
     * The iPhone app has no such line; the shape is the Mac app's `SongName.displayLine`, built from the lines above.
     */
    fun displayLine(song: Song): String {
        val artist = artistLine(song)
        return if (artist.isEmpty()) titleLine(song) else "$artist - ${titleLine(song)}"
    }

    private fun joined(song: Song, separator: String): String =
        listOf(artistLine(song), year(song)?.toString().orEmpty()).filter { it.isNotEmpty() }.joinToString(separator)
}
