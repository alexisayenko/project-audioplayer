@file:Suppress("PropertyName", "ConstructorParameterNaming")

package com.alexisayenko.audioplayer.android.data.api

import com.alexisayenko.audioplayer.android.data.Usage
import com.alexisayenko.audioplayer.android.model.Song
import com.alexisayenko.audioplayer.android.model.SongSource
import com.alexisayenko.audioplayer.android.model.SongVersion
import java.time.OffsetDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.put

/** The one JSON configuration of the app: unknown keys are ignored, so a server addition never breaks the phone (AND-057). */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/**
 * A song as the server's song endpoints return it (`GET /catalog`, `PATCH /songs/{id}`): the Swift `ServerSong` of
 * `ios/Sources/ServerLink.swift`, same keys, pinned by `server/tests/fixtures/ios_contract.json`.
 */
@Serializable
data class ServerSong(
    val id: String,
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    val remixer: String? = null,
    val year: Int? = null,
    val duration: Double? = null,
    val cover: String? = null,
    val cover_v: String? = null,
    val tags: List<String>? = null,
    val bpm: Double? = null,
    val source_url: String? = null,
    val wikipedia_song: String? = null,
    val wikipedia_artist: String? = null,
    val musicbrainz_url: String? = null,
    val added_at: String? = null,
    val audio_state: String? = null,
    val sources: List<SongSource>? = null,
    val version: SongVersion? = null,
    val mainArtists: List<String>? = null,
    val featuredArtists: List<String>? = null,
    val withArtists: List<String>? = null,
    val releaseYear: Int? = null,
    val albums: List<String>? = null,
    val genres: List<String>? = null,
    val remix_year: Int? = null,
    val rawTitle: String? = null,
    val wikipedia_album: String? = null,
    val discogs_url: String? = null,
) {
    /** The app's song for this record: the Swift `ServerSong.track`. The cover becomes the server path `/covers/<id>[?v=<cover_v>]`. */
    fun toSong(): Song = Song(
        id = id,
        title = title,
        artist = artist ?: "",
        duration = duration,
        thumbnail = if (cover != null) Endpoints.cover(id) + (cover_v?.let { "?v=$it" } ?: "") else null,
        album = album,
        remixer = remixer,
        year = year,
        tags = tags,
        bpm = bpm,
        sourceURL = source_url,
        wikipediaSong = wikipedia_song,
        wikipediaArtist = wikipedia_artist,
        musicbrainzURL = musicbrainz_url,
        addedAt = added_at?.let(::parseDate),
        sources = sources,
        onServer = audio_state?.let { it == "server" },
        version = version,
        mainArtists = mainArtists,
        featuredArtists = featuredArtists,
        withArtists = withArtists,
        releaseYear = releaseYear,
        albums = albums,
        genres = genres,
        remixYear = remix_year,
        rawTitle = rawTitle,
        wikipediaAlbum = wikipedia_album,
        discogsURL = discogs_url,
    )

    companion object {
        /** ISO 8601 with a zone (`2026-01-01T10:00:00Z`) to epoch milliseconds; null when the text is something else. */
        fun parseDate(text: String): Long? = try {
            OffsetDateTime.parse(text).toInstant().toEpochMilli()
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * `GET /catalog`: every song id and the song records (metadata only). Lossy like the Swift `CatalogResponse`:
 * a song that fails to decode is skipped and named in [skipped], never fatal.
 */
data class CatalogResponse(val ids: List<String>, val songs: List<ServerSong>, val skipped: List<String> = emptyList()) {
    companion object {
        /** Reads a catalog body; throws [SerializationException] only when the body as a whole is not a catalog. */
        fun decode(text: String, json: Json = ApiJson): CatalogResponse {
            val root = json.parseToJsonElement(text) as? JsonObject ?: throw SerializationException("catalog is not an object")
            val ids = when (val raw = root["ids"]) {
                null, JsonNull -> emptyList()
                else -> json.decodeFromJsonElement<List<String>>(raw)
            }
            val records = when (val raw = root["songs"]) {
                null, JsonNull -> emptyList()
                is JsonArray -> raw
                else -> throw SerializationException("catalog songs is not a list")
            }
            val songs = ArrayList<ServerSong>(records.size)
            val skipped = ArrayList<String>()
            for (record in records) {
                try {
                    songs += json.decodeFromJsonElement<ServerSong>(record)
                } catch (_: Exception) {
                    skipped += (((record as? JsonObject)?.get("id") as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "?")
                }
            }
            return CatalogResponse(ids, songs, skipped)
        }
    }
}

/** `GET /songs/{id}/status` and the answer of `POST /songs/{id}/audio`: the Swift `SongStatus`. */
@Serializable
data class SongStatus(
    val status: String,
    val progress: Double? = null,
    val error: String? = null,
    val code: String? = null,
    val state: String? = null,
    val error_code: String? = null,
) {
    /** The job waits for a download slot on the server. */
    val isQueued: Boolean get() = status == "queued" || state == "queued"
    val isConverting: Boolean get() = state == "converting"

    /** The server is working on the song (queued or downloading). */
    val isActive: Boolean get() = status == "queued" || status == "downloading"
    val isDone: Boolean get() = status == "done"
    val isError: Boolean get() = status == "error"

    /** The machine-readable reason of a failed job. */
    val failureCode: String? get() = error_code ?: code

    /** A failed job in words for the person; the server's raw text is only a last resort. */
    val failureMessage: String
        get() = when (failureCode) {
            "preview_only" -> "This link is only a preview, so there is no full song to download."
            "unsupported" -> "This link can't be downloaded."
            "library_full_bytes" -> "Your storage is full. Delete some songs to free space."
            "library_full_songs" -> "Your library is full. Delete some songs to add more."
            "server_full" -> "The server is out of storage right now. Try again later."
            "hourly_limit" -> "Hourly limit reached. Try again later."
            else -> if (error.isNullOrEmpty()) "The download failed. Try again." else "The download failed: $error"
        }
}

/** `GET /me/usage` (API-046): the owner's `max_*` are null. The Swift `ServerUsage`. */
@Serializable
data class ServerUsage(
    val songs: Int = 0,
    @SerialName("max_songs") val maxSongs: Int? = null,
    val bytes: Long = 0,
    @SerialName("max_bytes") val maxBytes: Long? = null,
    @SerialName("adds_last_hour") val addsLastHour: Int = 0,
    @SerialName("max_adds") val maxAdds: Int? = null,
) {
    /** Server audio fetches still allowed this hour; null without a limit (the owner). */
    val fetchesLeft: Int? get() = maxAdds?.let { maxOf(0, it - addsLastHour) }
    val bytesLeft: Long? get() = maxBytes?.let { maxOf(0, it - bytes) }

    fun toUsage(): Usage = Usage(songs = songs, maxSongs = maxSongs, bytes = bytes, maxBytes = maxBytes)
}

/** One row of `GET /tags`. */
@Serializable
data class TagCount(val tag: String, val count: Int = 0)

/** One service of a metadata lookup: whether the song was found there and its link. */
@Serializable
data class MetadataService(val found: Boolean? = null, val url: String? = null)

/** The services a metadata lookup looked in. */
@Serializable
data class MetadataServices(
    val youtube: MetadataService? = null,
    val soundcloud: MetadataService? = null,
    val wikipedia: MetadataService? = null,
    val spotify: MetadataService? = null,
    val musicbrainz: MetadataService? = null,
    val discogs: MetadataService? = null,
)

/** The artist and title Wikipedia suggests instead of the typed ones. */
@Serializable
data class MetadataSuggest(val artist: String? = null, val title: String? = null)

/** `POST /metadata`: what the lookup found for the Add/Edit form. Each field is read on its own, so one odd field never loses the rest (the Swift `MetadataResult`). */
data class MetadataResult(
    val album: String? = null,
    val year: Int? = null,
    val tags: List<String>? = null,
    val services: MetadataServices? = null,
    val suggest: MetadataSuggest? = null,
) {
    companion object {
        fun decode(text: String, json: Json = ApiJson): MetadataResult {
            val root = json.parseToJsonElement(text) as? JsonObject ?: throw SerializationException("metadata is not an object")
            fun <T> field(key: String, read: (JsonElement) -> T): T? = try {
                root[key]?.takeIf { it !is JsonNull }?.let(read)
            } catch (_: Exception) {
                null
            }
            return MetadataResult(
                album = field("album") { json.decodeFromJsonElement<String>(it) },
                year = field("year") { json.decodeFromJsonElement<Int>(it) },
                tags = field("tags") { json.decodeFromJsonElement<List<String>>(it) },
                services = field("services") { json.decodeFromJsonElement<MetadataServices>(it) },
                suggest = field("suggest") { json.decodeFromJsonElement<MetadataSuggest>(it) },
            )
        }
    }
}

/** The request bodies the app sends, built exactly as the iOS Add and Edit screens build them (`ios_contract.json` "requests"). */
object Payloads {
    private fun text(value: String?): JsonElement = value?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull
    private fun number(value: Int?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull

    /** The `metadata` block of `POST /songs` (the Add sheet's `meta`). */
    fun addMetadata(song: Song): JsonObject = buildJsonObject {
        put("title", song.title)
        put("artist", song.artist)
        put("album", song.album ?: "")
        put("remixer", text(song.remixer))
        put("year", number(song.year))
        put("wikipedia_song", text(song.wikipediaSong))
        put("wikipedia_artist", text(song.wikipediaArtist))
        put("musicbrainz_url", text(song.musicbrainzURL))
    }

    /** `POST /songs`: the link, the typed metadata and the tags; [audio] false saves the catalog entry only. Null [audio] leaves the key out (the server's default is true). */
    fun add(url: String, metadata: JsonObject, tags: List<String>, audio: Boolean? = true): JsonObject = buildJsonObject {
        put("url", url)
        put("metadata", metadata)
        put("tags", buildJsonArray { tags.forEach { add(JsonPrimitive(it)) } })
        if (audio != null) put("audio", audio)
    }

    /**
     * `PATCH /songs/{id}`: the title, the links and the tags always; artist, album, remixer and year only when they differ
     * from [base] (the song as stored), as `SongFormState.editChanges` does. Without [base] every key is sent.
     */
    fun edit(song: Song, base: Song? = null): JsonObject = buildJsonObject {
        fun plain(value: String?) = (value ?: "").trim()
        put("title", song.title)
        if (base == null || plain(song.artist) != plain(base.artist)) put("artist", song.artist)
        if (base == null || plain(song.album) != plain(base.album)) put("album", song.album ?: "")
        if (base == null || plain(song.remixer) != plain(base.remixer)) put("remixer", text(song.remixer))
        if (base == null || song.year != base.year) put("year", number(song.year))
        put("wikipedia_song", text(song.wikipediaSong))
        put("wikipedia_artist", text(song.wikipediaArtist))
        put("musicbrainz_url", text(song.musicbrainzURL))
        put("tags", buildJsonArray { (song.tags ?: emptyList()).forEach { add(JsonPrimitive(it)) } })
    }

    /** `POST /metadata`: the lookup of the Add/Edit form. */
    fun metadata(title: String, artist: String, sourceUrls: List<String>, wikiSong: String, wikiArtist: String): JsonObject = buildJsonObject {
        put("title", title)
        put("artist", artist)
        put("sources", buildJsonArray { sourceUrls.forEach { add(buildJsonObject { put("url", it) }) } })
        put("wiki_song", if (wikiSong.isEmpty()) JsonNull else JsonPrimitive(wikiSong))
        put("wiki_artist", if (wikiArtist.isEmpty()) JsonNull else JsonPrimitive(wikiArtist))
    }
}
