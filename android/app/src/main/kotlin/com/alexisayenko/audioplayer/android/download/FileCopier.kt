package com.alexisayenko.audioplayer.android.download

import com.alexisayenko.audioplayer.android.data.api.ApiClient
import com.alexisayenko.audioplayer.android.data.api.FileAnswer
import com.alexisayenko.audioplayer.android.data.store.LibraryIndex
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext

/** The pure decisions of the resumable copy (AND-053): which Range to ask for and what an answer means for the partial file. */
object RangeMath {
    /** `Content-Range: bytes <start>-<end>/<total>`; [total] is null when the server sends a star for it. */
    data class ContentRange(val start: Long, val end: Long, val total: Long?)

    /** What to do with the bytes of an answer. */
    sealed interface Step {
        /** Throw the partial file away and write the body from byte 0; [total] is the announced size, when known. */
        data class Restart(val total: Long?) : Step

        /** Append the body to the partial file. */
        data class Append(val total: Long?) : Step

        /** The partial file already holds every byte. */
        data object Complete : Step

        /** The partial file cannot be continued (the server's file changed or the answer does not fit): delete it and start again. */
        data object Discard : Step
    }

    /** The `Range` header for a partial file of [partialLength] bytes; null for a fresh start (a plain GET). */
    fun rangeHeader(partialLength: Long): String? = if (partialLength > 0) "bytes=$partialLength-" else null

    fun parseContentRange(header: String?): ContentRange? {
        val match = header?.let { Regex("""^\s*bytes\s+(\d+)-(\d+)/(\d+|\*)\s*$""").find(it) } ?: return null
        val (start, end, total) = match.destructured
        val s = start.toLongOrNull() ?: return null
        val e = end.toLongOrNull() ?: return null
        if (e < s) return null
        return ContentRange(s, e, total.toLongOrNull())
    }

    /** The total of an unsatisfied range answer (416), whose `Content-Range` is `bytes`, a star, a slash and the total. */
    fun parseUnsatisfiedTotal(header: String?): Long? =
        header?.let { Regex("""^\s*bytes\s+\*/(\d+)\s*$""").find(it) }?.groupValues?.get(1)?.toLongOrNull()

    /**
     * Reads an answer against a partial file of [partialLength] bytes whose earlier answers announced [knownTotal] bytes
     * (null when none did). 200 is the whole file; 206 continues only when it starts exactly where the partial file ends
     * and names the same total; 416 means the range starts at or after the end.
     */
    fun decide(partialLength: Long, knownTotal: Long?, code: Int, contentRange: String?, contentLength: Long?): Step = when (code) {
        200 -> Step.Restart(contentLength?.takeIf { it >= 0 })
        206 -> {
            val range = parseContentRange(contentRange)
            when {
                range == null || range.start != partialLength -> Step.Discard
                knownTotal != null && range.total != null && range.total != knownTotal -> Step.Discard
                else -> Step.Append(range.total ?: knownTotal)
            }
        }
        416 -> if (partialLength > 0 && parseUnsatisfiedTotal(contentRange) == partialLength) Step.Complete else Step.Discard
        else -> Step.Discard
    }

    /** True when a file of [length] bytes is all of an announced [total]; an unknown total is trusted at the end of the body. */
    fun isComplete(length: Long, total: Long?): Boolean = total == null || length == total

    /** 0..1 for the progress bar; 0 while the total is unknown. */
    fun fraction(length: Long, total: Long?): Float = if (total == null || total <= 0) 0f else (length.toFloat() / total).coerceIn(0f, 1f)
}

/** The copied file does not have the size the server announced; the partial file was deleted. */
class LengthMismatch(val expected: Long, val actual: Long) : IOException("The file arrived with $actual bytes instead of $expected")

/**
 * Copies a song's audio from `GET /files/{id}` onto the phone (AND-053). The bytes go to `<name>.part`; a partial file left
 * by an interruption is continued with `Range: bytes=<length>-`, looping over 206 answers because the server may cap each
 * at 768 KiB (API-318). When every announced byte is there the file is renamed to its final name in one step. A failed or
 * cancelled copy never leaves a file under the final name; the partial file stays for the next attempt.
 *
 * A note beside the partial file (`<name>.part.meta`) keeps the server's validator and the total, so a file that changed on
 * the server between attempts is fetched again from the start instead of being glued together from two versions.
 */
class FileCopier(private val api: ApiClient, private val io: CoroutineDispatcher = Dispatchers.IO) {
    private data class Note(val validator: String?, val total: Long?)

    private fun readNote(file: File): Note? = try {
        val lines = file.readLines()
        Note(lines.getOrNull(0)?.takeIf { it.isNotEmpty() }, lines.getOrNull(1)?.toLongOrNull())
    } catch (_: Exception) {
        null
    }

    private fun writeNote(file: File, note: Note) {
        runCatching { file.writeText((note.validator ?: "") + "\n" + (note.total?.toString() ?: "")) }
    }

    /**
     * Copies song [id] into [dest] through [part]. [onProgress] gets 0..1 as bytes arrive.
     * Throws `ApiError` for a refusal, [LengthMismatch] or another [IOException] for a broken transfer.
     */
    suspend fun copy(id: String, part: File, dest: File, onProgress: suspend (Float) -> Unit = {}) = withContext(io) {
        val noteFile = File(part.path + ".meta")
        part.parentFile?.mkdirs()
        var note = if (part.exists()) readNote(noteFile) else null
        if (part.exists() && note == null) part.delete()
        var stalls = 0
        while (true) {
            coroutineContext.ensureActive()
            val length = if (part.exists()) part.length() else 0L
            if (length > 0 && note?.total == length) break
            val answer = api.file(id, from = length, validator = note?.validator)
            val before = length
            val done = answer.use { open ->
                val response = open.response
                val step = RangeMath.decide(length, note?.total, response.code, response.header("Content-Range"), response.body.contentLength().takeIf { it >= 0 })
                when (step) {
                    RangeMath.Step.Complete -> true
                    RangeMath.Step.Discard -> {
                        part.delete()
                        noteFile.delete()
                        note = null
                        false
                    }
                    is RangeMath.Step.Restart, is RangeMath.Step.Append -> {
                        val append = step is RangeMath.Step.Append
                        val total = if (step is RangeMath.Step.Append) step.total else (step as RangeMath.Step.Restart).total
                        val fresh = Note(response.header("ETag") ?: response.header("Last-Modified") ?: note?.validator, total)
                        if (!append) part.delete()
                        writeNote(noteFile, fresh)
                        note = fresh
                        receive(open, part, append, total, onProgress)
                        val now = part.length()
                        if (total != null && now > total) {
                            part.delete()
                            noteFile.delete()
                            throw LengthMismatch(total, now)
                        }
                        total == null || now == total
                    }
                }
            }
            if (done) break
            val after = if (part.exists()) part.length() else 0L
            stalls = if (after > before) 0 else stalls + 1
            if (stalls >= MAX_STALLS) throw IOException("The server sent no data")
        }
        val total = note?.total
        val length = part.length()
        if (!part.exists() || length == 0L || !RangeMath.isComplete(length, total)) {
            part.delete()
            noteFile.delete()
            throw LengthMismatch(total ?: -1, length)
        }
        LibraryIndex.move(part, dest)
        noteFile.delete()
        onProgress(1f)
    }

    private suspend fun receive(answer: FileAnswer, part: File, append: Boolean, total: Long?, onProgress: suspend (Float) -> Unit) {
        val stop = coroutineContext.job.invokeOnCompletion { answer.cancel() }
        try {
            FileOutputStream(part, append).use { out ->
                val input = answer.response.body.byteStream()
                val buffer = ByteArray(BUFFER_BYTES)
                var written = if (append) part.length() else 0L
                var reported = -1
                while (true) {
                    coroutineContext.ensureActive()
                    val n = input.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    written += n
                    val percent = (RangeMath.fraction(written, total) * 100).toInt()
                    if (percent != reported) {
                        reported = percent
                        onProgress(RangeMath.fraction(written, total))
                    }
                }
                out.fd.sync()
            }
        } finally {
            stop.dispose()
        }
    }

    private companion object {
        const val BUFFER_BYTES = 64 * 1024
        const val MAX_STALLS = 3
    }
}
