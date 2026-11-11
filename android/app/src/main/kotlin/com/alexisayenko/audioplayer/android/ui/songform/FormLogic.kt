package com.alexisayenko.audioplayer.android.ui.songform

import com.alexisayenko.audioplayer.android.logic.countryCode
import com.alexisayenko.audioplayer.android.logic.hasTag
import com.alexisayenko.audioplayer.android.logic.splitTagInput
import com.alexisayenko.audioplayer.android.logic.tagKey
import com.alexisayenko.audioplayer.android.logic.trimSpaces

// Small pure helpers of the song form that the `logic` package does not hold: ports of `commitNamespaced` and
// `finalTags` of `ios/Sources/TagComponents.swift`.

/** What [commitNamespaced] gives: the new tag list, the text to leave in the field and a note when something was refused. */
internal data class NamespacedCommit(val tags: List<String>, val input: String, val note: String?)

/** True for the two characters that split typed genres and countries. */
internal fun isNamespaceSeparator(c: Char): Boolean = c == ',' || c == '/'

/**
 * Splits [input] on commas and slashes into `key:` tags (genres lower-cased, countries through `countryCode`),
 * skipping duplicates and unknown countries. Unless [final], the text after the last separator stays in the field.
 * Swift changes the list and the text in place; here both come back in the result.
 */
internal fun commitNamespaced(tags: List<String>, key: String, cap: Int, input: String, final: Boolean = true): NamespacedCommit {
    val parts = input.split(',', '/').map { it.trimSpaces() }.toMutableList()
    val rest = if (final) "" else parts.removeAt(parts.size - 1)
    val out = tags.toMutableList()
    var note: String? = null
    for (raw in parts) {
        if (raw.isEmpty()) continue
        val value = if (key == "country") countryCode(raw) else raw.lowercase()
        if (value == null) {
            note = "Unknown country"
            continue
        }
        val tag = "$key:$value"
        if (hasTag(out, tag)) continue
        if (out.count { tagKey(it) == key } >= cap) {
            note = "Up to $cap"
            break
        }
        out.add(tag)
    }
    return NamespacedCommit(out, rest, note)
}

/** [tags] plus whatever is still typed in the tag field. */
internal fun finalTags(tags: List<String>, pending: String): List<String> {
    val out = tags.toMutableList()
    for (t in splitTagInput(pending).tags) if (!hasTag(out, t)) out.add(t)
    return out
}

/** The text after the last comma or slash: what the genre suggestions look at. */
internal fun lastNamespacePart(input: String): String = input.split(',', '/').last()

/** [input] with its last comma- or slash-separated part replaced by [value] (a picked genre suggestion). */
internal fun replaceLastNamespacePart(input: String, value: String): String {
    val parts = input.split(',', '/').toMutableList()
    parts[parts.size - 1] = value
    return parts.joinToString(",")
}
