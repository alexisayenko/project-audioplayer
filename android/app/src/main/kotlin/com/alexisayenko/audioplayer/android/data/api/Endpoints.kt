package com.alexisayenko.audioplayer.android.data.api

/** The server's paths: the table of `ios/Sources/Endpoints.swift`, limited to what the Android app uses (AND-021). */
object Endpoints {
    const val TAGS = "/tags"
    const val CATALOG = "/catalog"
    const val SEARCH = "/search"
    const val PREVIEW = "/preview"
    const val SONGS = "/songs"
    const val METADATA = "/metadata"
    const val GENRES = "/genres"
    const val STATS_LISTENING = "/stats/listening"
    const val PLAYS = "/plays"
    const val COVERS_PREFIX = "/covers/"
    const val ME_USAGE = "/me/usage"
    const val PLAYLISTS = "/playlists"
    const val ALBUMS = "/albums"

    fun file(id: String): String = "/files/$id"
    fun cover(id: String): String = "$COVERS_PREFIX$id"
    fun song(id: String): String = "/songs/$id"
    fun songStatus(id: String): String = "/songs/$id/status"
    fun songAudio(id: String): String = "/songs/$id/audio"
    fun songCover(id: String): String = "/songs/$id/cover"
    fun playlist(id: String): String = "/playlists/$id"
    fun playlistSongs(id: String): String = "/playlists/$id/songs"
    fun playlistSong(id: String, songId: String): String = "/playlists/$id/songs/$songId"
    fun playlistOrder(id: String): String = "/playlists/$id/order"
    fun album(id: String): String = "/albums/$id"
}
