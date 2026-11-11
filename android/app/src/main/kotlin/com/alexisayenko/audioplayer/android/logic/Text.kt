package com.alexisayenko.audioplayer.android.logic

import java.text.Normalizer
import java.util.Locale

/*
 * Text helpers shared by the ports in this package. Swift's `Character`/`Unicode.Scalar` rules are spelled out here
 * because `Char.isWhitespace()` on the JVM is a different set (it leaves out U+00A0 and adds U+001C..U+001F).
 */

/** Unicode `White_Space`, the set behind Swift's `Unicode.Scalar.Properties.isWhitespace` and `.whitespacesAndNewlines`. */
internal fun isUnicodeWhitespace(cp: Int): Boolean = when (cp) {
    in 0x09..0x0D, 0x20, 0x85, 0xA0, 0x1680, in 0x2000..0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000 -> true
    else -> false
}

/** Spaces and tabs without line breaks: Swift's `CharacterSet.whitespaces` (category Zs plus the tab). */
internal fun isInlineSpace(cp: Int): Boolean = when (cp) {
    0x09, 0x20, 0xA0, 0x1680, in 0x2000..0x200A, 0x202F, 0x205F, 0x3000 -> true
    else -> false
}

private inline fun String.trimBy(start: Boolean, end: Boolean, drop: (Int) -> Boolean): String {
    var from = 0
    var to = length
    if (start) {
        while (from < to) {
            val cp = codePointAt(from)
            if (!drop(cp)) break
            from += Character.charCount(cp)
        }
    }
    if (end) {
        while (to > from) {
            val cp = codePointBefore(to)
            if (!drop(cp)) break
            to -= Character.charCount(cp)
        }
    }
    return substring(from, to)
}

/** Swift `trimmingCharacters(in: .whitespacesAndNewlines)`. */
internal fun String.trimWhitespace(): String = trimBy(start = true, end = true, drop = ::isUnicodeWhitespace)

/** Drops trailing Unicode white space only. */
internal fun String.trimWhitespaceEnd(): String = trimBy(start = false, end = true, drop = ::isUnicodeWhitespace)

/** Drops leading Unicode white space only. */
internal fun String.trimWhitespaceStart(): String = trimBy(start = true, end = false, drop = ::isUnicodeWhitespace)

/** Swift `trimmingCharacters(in: .whitespaces)`: spaces and tabs, line breaks stay. */
internal fun String.trimSpaces(): String = trimBy(start = true, end = true, drop = ::isInlineSpace)

private val combiningMarks = Regex("\\p{Mn}+")

/**
 * Case- and accent-blind form of a text, for search and sorting ("Café" and "CAFE" give the same result).
 *
 * Stands in for Swift's `folding(options: [.caseInsensitive, .diacriticInsensitive])`: the text is decomposed (NFD),
 * its combining marks are dropped and the rest is lower-cased without a locale. Difference from Foundation: Swift
 * case-folds ("ß" becomes "ss", final sigma becomes "σ"), this lower-cases, so those few letters keep their own form.
 */
internal fun foldText(text: String): String =
    combiningMarks.replace(Normalizer.normalize(text, Normalizer.Form.NFD), "").lowercase(Locale.ROOT)

/** Swift's `String.capitalized`: the first letter of every word in upper case, the rest in lower case. */
internal fun capitalizeWords(text: String): String {
    val out = StringBuilder(text.length)
    var startOfWord = true
    for (ch in text) {
        out.append(if (startOfWord) ch.uppercaseChar() else ch.lowercaseChar())
        startOfWord = !ch.isLetterOrDigit() && ch != '\''
    }
    return out.toString()
}
