package com.alexisayenko.audioplayer.android.data.store

import com.alexisayenko.audioplayer.android.model.Song
import java.io.File
import java.text.Normalizer
import java.util.Locale

/**
 * Names of the audio files in `filesDir/audio`: "Artist - Title.m4a" instead of "<id>.m4a". A port of
 * `ios/Sources/AudioFiles.swift` with the same naming, cleaning and legacy fallback (AND-056, IOS-075a).
 * The id to file name map is kept in `library.json` and `phone-index.json` ([LibraryIndex]); an id without an entry uses the
 * legacy name `<id>.m4a`. Every read and write of the map, and every move of a file, happens under one lock, so a path never
 * points at a half-renamed file.
 *
 * @param directory the audio folder; created when missing
 */
class AudioFiles(val directory: File) {
    private val lock = Any()
    private val names = HashMap<String, String>()

    init {
        directory.mkdirs()
    }

    /** Where the song's audio is or would be: its mapped file, else the legacy `<id>.m4a`. */
    fun file(id: String): File = File(directory, synchronized(lock) { names[id] } ?: legacyName(id))

    /** Replaces the map with the stored one; entries that are not a plain `.m4a` file name are ignored. */
    fun load(map: Map<String, String>?) {
        val valid = (map ?: emptyMap()).filterValues { it.isNotEmpty() && !it.contains('/') && it.endsWith(".$EXT") }
        synchronized(lock) {
            names.clear()
            names.putAll(valid)
        }
    }

    /** The map entries of [ids], for saving. */
    fun snapshot(ids: Set<String>): Map<String, String> = synchronized(lock) { names.filterKeys { it in ids } }

    fun forget(id: String) {
        synchronized(lock) { names.remove(id) }
    }

    /** The first of `base`, `base (2)`, `base (3)`... that no other song owns and no file occupies. Call under the lock. */
    private fun freeName(base: String, id: String): String? {
        val taken = names.filterKeys { it != id }.values.mapTo(HashSet(), ::fold)
        for (n in 1..MAX_COLLISIONS) {
            val candidate = candidate(base, n)
            if (fold(candidate) in taken) continue
            if (File(directory, candidate).exists()) continue
            return candidate
        }
        return null
    }

    /**
     * Where a song's audio is to be written: its mapped file, the legacy file if that exists, else a new readable name.
     * Songs without a usable title keep `<id>.m4a` and are renamed by [sync] once they have one.
     */
    fun reserve(song: Song): File = synchronized(lock) {
        names[song.id]?.let { return File(directory, it) }
        val legacy = File(directory, legacyName(song.id))
        val base = baseName(song.title, song.artist)
        if (base == null || legacy.exists()) return legacy
        val name = freeName(base, song.id) ?: return legacy
        names[song.id] = name
        File(directory, name)
    }

    /**
     * Renames the song's file to match its current artist and title; true when the name changed.
     * Does nothing for a song with no file and no map entry, without a usable title, or whose name already fits.
     * A failed move leaves everything as it was.
     */
    fun sync(song: Song): Boolean {
        val base = baseName(song.title, song.artist) ?: return false
        return synchronized(lock) {
            val mapped = names[song.id]
            val current = mapped ?: legacyName(song.id)
            val from = File(directory, current)
            val present = from.exists()
            if (mapped == null && !present) return false
            if (matches(current.substringBeforeLast('.'), base)) return false
            val name = freeName(base, song.id) ?: return false
            if (present && !from.renameTo(File(directory, name))) return false
            names[song.id] = name
            true
        }
    }

    /**
     * Gives back the map entries lost with the index: a song with no entry and no legacy file gets the file that is named for
     * its artist and title (`base`, `base (2)`, ...) when it exists in [dir] and no other song owns it. True when an entry was added.
     */
    fun adopt(songs: List<Song>, dir: File = directory): Boolean = synchronized(lock) {
        var changed = false
        for (song in songs) {
            if (names.containsKey(song.id) || File(dir, legacyName(song.id)).exists()) continue
            val base = baseName(song.title, song.artist) ?: continue
            val taken = names.values.mapTo(HashSet(), ::fold)
            for (n in 1..MAX_ADOPT_SCAN) {
                val candidate = candidate(base, n)
                if (fold(candidate) in taken || !File(dir, candidate).exists()) continue
                names[song.id] = candidate
                changed = true
                break
            }
        }
        changed
    }

    /** [sync] for every song; true when any name changed. */
    fun syncAll(songs: List<Song>): Boolean {
        var changed = false
        for (song in songs) if (sync(song)) changed = true
        return changed
    }

    companion object {
        private const val EXT = "m4a"
        private const val MAX_BASE = 120
        private const val MAX_COLLISIONS = 1000
        private const val MAX_ADOPT_SCAN = 20
        private const val BANNED = "/:\\?*\"<>|"

        private fun legacyName(id: String) = "$id.$EXT"

        private fun candidate(base: String, n: Int) = (if (n == 1) base else "$base ($n)") + "." + EXT

        /** "Artist - Title", or just the title without an artist; null without a usable title. */
        fun baseName(title: String, artist: String): String? {
            val t = clean(title)
            if (t.isEmpty()) return null
            val a = clean(artist)
            val joined = if (a.isEmpty()) t else "$a - $t"
            val end = joined.offsetByCodePoints(0, minOf(MAX_BASE, joined.codePointCount(0, joined.length)))
            return trim(joined.substring(0, end))
        }

        /** Strips characters a file system dislikes, turns every whitespace run into one space, trims dots and spaces. */
        fun clean(text: String): String {
            val out = StringBuilder(text.length)
            var i = 0
            while (i < text.length) {
                val cp = text.codePointAt(i)
                i += Character.charCount(cp)
                when {
                    isSpace(cp) -> out.append(' ')
                    cp < 0x80 && BANNED.indexOf(cp.toChar()) >= 0 -> Unit
                    Character.getType(cp).let { it == Character.CONTROL.toInt() || it == Character.FORMAT.toInt() || it == Character.UNASSIGNED.toInt() || it == Character.SURROGATE.toInt() } -> Unit
                    else -> out.appendCodePoint(cp)
                }
            }
            return trim(out.split(' ').filter { it.isNotEmpty() }.joinToString(" "))
        }

        private fun isSpace(cp: Int) = Character.isWhitespace(cp) || Character.isSpaceChar(cp) || cp == 0x85

        private fun trim(text: String) = text.trim { it == '.' || it == ' ' || isSpace(it.code) }

        private fun fold(text: String) = Normalizer.normalize(text, Normalizer.Form.NFC).lowercase(Locale.ROOT)

        /** True when [stem] is [base] or `base (n)`, so a name that already got a collision suffix stays put. */
        private fun matches(stem: String, base: String): Boolean {
            val s = fold(stem)
            val b = fold(base)
            if (s == b) return true
            if (!s.startsWith("$b (") || !s.endsWith(")")) return false
            return s.substring(b.length + 2, s.length - 1).toIntOrNull() != null
        }
    }
}
