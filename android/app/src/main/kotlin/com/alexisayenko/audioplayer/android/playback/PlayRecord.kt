package com.alexisayenko.audioplayer.android.playback

import java.io.File
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * One finished play as `POST /plays` takes it (API-196; the Swift `PlayRecord` in `PlayQueue.swift`). On the wire the fields
 * are `timestamp`, `song_id`, `listened_s` and `cont`; [cont] marks a continuation of the previous play of the same song and
 * is left out when null.
 */
@Serializable
data class PlayRecord(
    /** When the play began, ISO 8601 in UTC with milliseconds. */
    val timestamp: String,
    @SerialName("song_id") val songID: String,
    /** Seconds actually heard. */
    @SerialName("listened_s") val listened: Double,
    val cont: Boolean? = null,
)

/** Small JSON files of the play log under one folder (the Swift `PlayStore`): atomic writes, a missing or broken file reads as null. */
internal object PlayStore {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    fun <T> read(serializer: KSerializer<T>, name: String, dir: File): T? =
        runCatching { json.decodeFromString(serializer, File(dir, name).readText()) }.getOrNull()

    /** Writes [value] as [name], or deletes the file when [value] is null. */
    fun <T> write(serializer: KSerializer<T>, value: T?, name: String, dir: File) {
        val file = File(dir, name)
        if (value == null) {
            file.delete()
            return
        }
        writeAtomically(file, json.encodeToString(serializer, value))
    }

    /** Writes [text] to a temporary file and renames it over [file], so a crash never leaves half a file. */
    fun writeAtomically(file: File, text: String) {
        runCatching {
            file.parentFile?.mkdirs()
            val temp = File(file.parentFile, file.name + ".tmp")
            temp.writeText(text)
            if (!temp.renameTo(file)) {
                file.delete()
                temp.renameTo(file)
            }
        }
    }
}
