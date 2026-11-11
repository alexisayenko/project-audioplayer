package com.alexisayenko.audioplayer.android.logic

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/*
 * The Wikipedia field of the song form shows an article name and stores a link.
 * Ports the pure functions of `ios/Sources/WikiLink.swift` (the text field itself is UI).
 */

private const val WIKI_SECTION = "/wiki/"
private const val WIKI_PREFIX = "https://en.wikipedia.org$WIKI_SECTION"
private val wikiPattern = Regex("^https?://(m\\.)?en\\.wikipedia\\.org/wiki/(.+)$", RegexOption.IGNORE_CASE)
private val httpScheme = Regex("^https?://", RegexOption.IGNORE_CASE)
private const val WIKI_ALLOWED = "()',.:!*~-_"

/** Swift `removingPercentEncoding`: null when a `%` is not followed by two hex digits or the bytes are not UTF-8. */
private fun percentDecode(text: String): String? {
    val raw = text.toByteArray(Charsets.UTF_8)
    val out = ByteBuffer.allocate(raw.size)
    var i = 0
    while (i < raw.size) {
        if (raw[i] != '%'.code.toByte()) {
            out.put(raw[i])
            i += 1
            continue
        }
        if (i + 2 >= raw.size) return null
        val hi = Character.digit(raw[i + 1].toInt().toChar(), 16)
        val lo = Character.digit(raw[i + 2].toInt().toChar(), 16)
        if (hi < 0 || lo < 0) return null
        out.put((hi * 16 + lo).toByte())
        i += 3
    }
    out.flip()
    val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    return try {
        decoder.decode(out).toString()
    } catch (_: CharacterCodingException) {
        null
    }
}

/**
 * What the field shows for a stored link: the article name for an English Wikipedia link
 * ("…/wiki/The_Prodigy" is "The Prodigy"), any other text as it is.
 */
fun wikiDisplay(url: String): String {
    if (!wikiPattern.containsMatchIn(url)) return url
    val slash = url.indexOf(WIKI_SECTION, ignoreCase = true)
    if (slash < 0) return url
    var title = url.substring(slash + WIKI_SECTION.length)
    val cut = title.indexOfFirst { it == '#' || it == '?' }
    if (cut >= 0) title = title.substring(0, cut)
    if (title.isEmpty()) return url
    return (percentDecode(title) ?: title).replace("_", " ")
}

/**
 * What is stored for typed text: a full link is kept (trimmed), an article name becomes its English Wikipedia link,
 * blank text becomes "".
 */
fun wikiNormalize(text: String): String {
    val t = text.trimWhitespace()
    if (t.isEmpty()) return ""
    if (httpScheme.containsMatchIn(t)) return t
    val name = StringBuilder()
    // As Swift's `addingPercentEncoding`: ASCII letters, digits and the allowed marks stay, every other byte is escaped.
    for (b in t.replace(" ", "_").toByteArray(Charsets.UTF_8)) {
        val c = b.toInt() and 0xFF
        val ch = c.toChar()
        if (c < 0x80 && (ch in 'a'..'z' || ch in 'A'..'Z' || ch in '0'..'9' || ch in WIKI_ALLOWED)) {
            name.append(ch)
        } else {
            name.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 0xF])
        }
    }
    return WIKI_PREFIX + name
}
