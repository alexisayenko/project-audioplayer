package com.alexisayenko.audioplayer.android.model

import kotlinx.serialization.Serializable

/** One place a song comes from (`sources` of a catalog song). */
@Serializable
data class SongSource(val source: String? = null, val id: String? = null, val url: String? = null)

/** The server's `version` block of a song: what kind of derivation it is (remix, cover, live, ...), shown read-only. */
@Serializable
data class SongVersion(
    val type: String? = null,
    val name: String? = null,
    val artists: List<String>? = null,
    val releaseYear: Int? = null,
    val originalArtists: List<String>? = null,
)

/**
 * A song in the catalog: the Kotlin counterpart of the iOS `Track` (same field names, so `library.json` and `phone-index.json`
 * keep the iOS shape, AND-057). Its audio may be on the phone, on the server only, or nowhere yet (ADR-0010).
 * `addedAt` is epoch milliseconds (iOS stores a `Date`).
 */
@Serializable
data class Song(
    val id: String,
    val title: String,
    val artist: String = "",
    val duration: Double? = null,
    /** Absolute image URL or the server path `/covers/<id>`; never holds a token. */
    val thumbnail: String? = null,
    val album: String? = null,
    val remixer: String? = null,
    val year: Int? = null,
    val tags: List<String>? = null,
    val bpm: Double? = null,
    val sourceURL: String? = null,
    val wikipediaSong: String? = null,
    val wikipediaArtist: String? = null,
    val musicbrainzURL: String? = null,
    val addedAt: Long? = null,
    val sources: List<SongSource>? = null,
    /** The server holds the audio (`audio_state` "server"). Null means unknown, treated as yes. */
    val onServer: Boolean? = null,
    /** The server dropped this song from the catalog while its audio is still on the phone. */
    val localOnly: Boolean? = null,
    val version: SongVersion? = null,
    val mainArtists: List<String>? = null,
    val featuredArtists: List<String>? = null,
    val withArtists: List<String>? = null,
    val releaseYear: Int? = null,
    val albums: List<String>? = null,
    val genres: List<String>? = null,
    val remixYear: Int? = null,
    val rawTitle: String? = null,
    val wikipediaAlbum: String? = null,
    val discogsURL: String? = null,
) {
    /** Fills the server-only fields this song lacks from [other], so a song built from a preview never erases them. */
    fun inheritDetail(other: Song): Song = copy(
        version = version ?: other.version,
        mainArtists = mainArtists ?: other.mainArtists,
        featuredArtists = featuredArtists ?: other.featuredArtists,
        withArtists = withArtists ?: other.withArtists,
        releaseYear = releaseYear ?: other.releaseYear,
        albums = albums ?: other.albums,
        genres = genres ?: other.genres,
        remixYear = remixYear ?: other.remixYear,
        rawTitle = rawTitle ?: other.rawTitle,
        wikipediaAlbum = wikipediaAlbum ?: other.wikipediaAlbum,
        discogsURL = discogsURL ?: other.discogsURL,
    )
}

/** `POST /preview`: what the server found behind a pasted link (the iOS `Preview`, snake_case on the wire). */
@Serializable
data class Preview(
    val id: String,
    val source: String? = null,
    val source_url: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val remixer: String? = null,
    val year: Int? = null,
    val duration: Double? = null,
    val thumbnail: String? = null,
    val tags: List<String>? = null,
    val wikipedia_song: String? = null,
    val wikipedia_artist: String? = null,
    val in_library: Boolean? = null,
)
