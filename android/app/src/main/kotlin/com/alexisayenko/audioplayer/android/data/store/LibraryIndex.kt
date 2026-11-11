package com.alexisayenko.audioplayer.android.data.store

import com.alexisayenko.audioplayer.android.data.api.ApiJson
import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/**
 * The song index on the phone, a port of `ios/Sources/LibraryIndex.swift` with the same files and shapes (AND-057, IOS-107):
 * the cached server catalog (`library.json`, schema 2 with the ETag) and beside it what offline playback needs
 * (`phone-index.json`: the id to file name map and the records of the songs whose audio is on the phone).
 * A catalog that cannot be read is kept as `library.json.corrupt-<stamp>` (the newest three), the last good copy
 * (`library.json.good`) or the phone index stands in for it, and a single unreadable song record is dropped instead of the
 * whole file, so audio already on the phone stays playable without a sync. Writes go to a temp file that is then renamed.
 */
class LibraryIndex(
    val catalogFile: File,
    val phoneFile: File,
    private val now: () -> Long = System::currentTimeMillis,
    private val json: Json = ApiJson,
) {
    /** The last catalog that loaded cleanly. */
    val goodFile: File get() = File(catalogFile.path + ".good")

    /** What [load] found. [recovered] means something was damaged and the next sync must refetch the catalog ([etag] is then null). */
    data class Loaded(
        val songs: List<Song> = emptyList(),
        val files: Map<String, String> = emptyMap(),
        val etag: String? = null,
        val recovered: Boolean = false,
        /** The ids `phone-index.json` listed, so the caller can tell when it is out of date. */
        val phoneIds: Set<String> = emptySet(),
    )

    @Serializable
    private data class CatalogOut(val etag: String? = null, val schema: Int? = null, val songs: List<Song>, val files: Map<String, String>? = null)

    @Serializable
    @OptIn(ExperimentalSerializationApi::class)
    private data class PhoneOut(@EncodeDefault val version: Int = 1, val files: Map<String, String>, val songs: List<Song>)

    private class Catalog(val etag: String?, val schema: Int?, val songs: List<Song>, val files: Map<String, String>?, val dropped: Int)

    private class Phone(val files: Map<String, String>, val songs: List<Song>)

    private sealed interface Read<out T> {
        data object Missing : Read<Nothing>
        data object Corrupt : Read<Nothing>
        class Ok<T>(val value: T) : Read<T>
    }

    private fun <T> read(file: File, parse: (JsonElement) -> T): Read<T> {
        if (!file.exists()) return Read.Missing
        return try {
            Read.Ok(parse(json.parseToJsonElement(file.readText())))
        } catch (_: Exception) {
            Read.Corrupt
        }
    }

    /** Song records one by one: an unreadable one is dropped. Returns the songs and how many were dropped. */
    private fun songs(list: JsonElement?): Pair<List<Song>, Int> {
        val records = list as? JsonArray ?: throw IllegalArgumentException("songs is not a list")
        val out = ArrayList<Song>(records.size)
        for (record in records) {
            try {
                out += json.decodeFromJsonElement<Song>(normalise(record))
            } catch (_: Exception) {
                // dropped: counted by the caller through the size difference
            }
        }
        return out to (records.size - out.size)
    }

    /**
     * `addedAt` is epoch milliseconds here; a file written by the iOS app holds seconds since 2001 as a fraction. Both are read,
     * and a null `artist` reads as none.
     */
    private fun normalise(record: JsonElement): JsonElement {
        var obj = record as? JsonObject ?: return record
        if (obj["artist"] is JsonNull) obj = JsonObject(obj - "artist")
        val added = obj["addedAt"] as? JsonPrimitive ?: return obj
        if (added is JsonNull) return obj
        val value = added.takeIf { !it.isString }?.doubleOrNull ?: return JsonObject(obj - "addedAt")
        val millis = if (value < SWIFT_DATE_CEILING) ((value + SWIFT_REFERENCE_SECONDS) * 1000).toLong() else value.toLong()
        return JsonObject(obj + ("addedAt" to JsonPrimitive(millis)))
    }

    private fun strings(element: JsonElement?): Map<String, String>? =
        if (element == null || element is JsonNull) null else json.decodeFromJsonElement<Map<String, String>>(element)

    private fun readCatalog(file: File): Read<Catalog> = read(file) { root ->
        if (root is JsonObject) {
            val (songs, dropped) = songs(root["songs"])
            val etag = (root["etag"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val schema = (root["schema"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.intOrNull ?: throw IllegalArgumentException("schema") }
            Catalog(etag, schema, songs, strings(root["files"]), dropped)
        } else {
            val (songs, dropped) = songs(root)
            Catalog(null, null, songs, null, dropped)
        }
    }

    private fun readPhone(file: File): Read<Phone> = read(file) { root ->
        val obj = root as? JsonObject ?: throw IllegalArgumentException("phone index is not an object")
        Phone(strings(obj["files"]) ?: emptyMap(), songs(obj["songs"]).first)
    }

    /** Reads both files, recovering what can be recovered. Never throws. */
    fun load(): Loaded {
        var recovered = false
        var catalog: Catalog? = null
        when (val read = readCatalog(catalogFile)) {
            is Read.Ok -> catalog = read.value
            Read.Missing -> Unit
            Read.Corrupt -> {
                quarantine(catalogFile)
                recovered = true
                (readCatalog(goodFile) as? Read.Ok)?.let { catalog = it.value }
            }
        }
        var phone: Phone? = null
        when (val read = readPhone(phoneFile)) {
            is Read.Ok -> phone = read.value
            Read.Missing -> Unit
            Read.Corrupt -> {
                quarantine(phoneFile)
                recovered = true
            }
        }
        var songs = catalog?.songs ?: emptyList()
        val files = LinkedHashMap(catalog?.files ?: emptyMap())
        phone?.let { p ->
            files.putAll(p.files)
            if (recovered || catalog == null) {
                val have = songs.mapTo(HashSet()) { it.id }
                val missing = p.songs.filter { it.id !in have }
                songs = songs + missing
                if (missing.isNotEmpty()) recovered = true
            }
        }
        val loaded = catalog
        if (loaded != null && loaded.dropped > 0) recovered = true
        val etag = if (loaded != null && !recovered && loaded.schema == SCHEMA) loaded.etag else null
        if (!recovered && songs.isNotEmpty()) refreshGoodCopy()
        return Loaded(songs, files, etag, recovered, phone?.songs?.mapTo(HashSet()) { it.id } ?: emptySet())
    }

    /** Writes the catalog cache and the phone index (the songs and file names of [phoneIds] only). */
    fun save(etag: String?, songs: List<Song>, files: Map<String, String>, phoneIds: Set<String>) {
        val catalog = CatalogOut(etag, SCHEMA, songs, files)
        val phone = PhoneOut(files = files.filterKeys { it in phoneIds }, songs = songs.filter { it.id in phoneIds })
        write(json.encodeToString(CatalogOut.serializer(), catalog), catalogFile)
        write(json.encodeToString(PhoneOut.serializer(), phone), phoneFile)
    }

    private fun write(text: String, file: File): Boolean = try {
        file.parentFile?.mkdirs()
        val temp = File(file.path + ".tmp")
        FileOutputStream(temp).use {
            it.write(text.toByteArray())
            it.fd.sync()
        }
        move(temp, file)
        true
    } catch (_: Exception) {
        false
    }

    private fun refreshGoodCopy() {
        val temp = File(goodFile.path + ".tmp")
        try {
            catalogFile.copyTo(temp, overwrite = true)
            move(temp, goodFile)
        } catch (_: Exception) {
            temp.delete()
        }
    }

    private fun quarantine(file: File) {
        val directory = file.parentFile ?: return
        val prefix = file.name + ".corrupt-"
        val copy = File(directory, prefix + STAMP.format(Instant.ofEpochMilli(now())))
        if (!copy.exists()) runCatching { file.copyTo(copy) }
        val names = (directory.list() ?: emptyArray()).filter { it.startsWith(prefix) }.sorted()
        names.dropLast(KEPT_CORRUPT_COPIES).forEach { File(directory, it).delete() }
    }

    companion object {
        /** The `schema` of `library.json`; an older one keeps its songs and drops the ETag, so the catalog is fetched again. */
        const val SCHEMA = 2
        private const val KEPT_CORRUPT_COPIES = 3
        private const val SWIFT_REFERENCE_SECONDS = 978_307_200.0
        private const val SWIFT_DATE_CEILING = 100_000_000_000.0
        private val STAMP = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss").withZone(ZoneOffset.UTC)

        /** Replaces [to] with [from] in one step, so a reader sees the old file or the new one, never half of either. */
        fun move(from: File, to: File) {
            try {
                Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        }
    }
}
