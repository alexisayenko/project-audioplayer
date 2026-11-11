package com.alexisayenko.audioplayer.android.logic

import com.alexisayenko.audioplayer.android.model.Song
import java.time.Year
import java.util.IllformedLocaleException
import java.util.Locale

/*
 * Link cleaning, the offline library match and the tag rules: ports of the non-UI functions of
 * `ios/Sources/TagLogic.swift`, checked against `url_clean_cases.json` and `tag_cases.json`.
 *
 * Regex notes: Swift uses NSRegularExpression (ICU), where `\s` and `\d` are Unicode-wide. The JVM's are ASCII-only
 * and Android's are Unicode-wide, so the patterns below spell the classes out to behave the same everywhere.
 */

/** Unicode white space for use inside a character class. */
private const val WS = "\\s\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000"

private fun rx(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE)

private val youtubeId = rx("^[A-Za-z0-9_-]{11}$")
private val youtubePatterns = listOf(
    rx("^(?:https?://)?(?:www\\.|m\\.|music\\.)?youtube\\.com/watch\\?(?:.*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$"),
    rx("^(?:https?://)?(?:www\\.|m\\.|music\\.)?youtube\\.com/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})(?:[/?#].*)?$"),
    rx("^(?:https?://)?youtu\\.be/([A-Za-z0-9_-]{11})(?:[/?#].*)?$"),
)
private val trackingParams = setOf("si", "feature", "pp", "fbclid", "gclid")

private val soundcloudHosts = setOf("soundcloud.com", "www.soundcloud.com", "m.soundcloud.com")
private val soundcloudReservedUsers = setOf(
    "discover", "stations", "you", "charts", "search", "upload", "feed", "pages", "popular",
    "mobile", "settings", "notifications", "messages", "jobs", "terms-of-use", "creators", "go",
)
private val soundcloudReservedSecond = setOf(
    "tracks", "albums", "sets", "reposts", "likes", "spotlight", "comments", "popular-tracks",
    "following", "followers", "playlists",
)
private val linkShape = rx("^(?:https?://)?([A-Za-z0-9.-]+)(/[^?#]*)?(?:[?#].*)?$")
private val soundcloudShortCode = rx("^[A-Za-z0-9]{3,32}$")
private val soundcloudName = rx("^[A-Za-z0-9_-]+$")
private val soundcloudSecret = rx("^s-[A-Za-z0-9]+$")
private val soundcloudId = rx("^soundcloud-[0-9]{1,20}$")
private val pastedLink = rx(
    "(?:https?://|(?:www\\.|m\\.|music\\.)?youtu(?:\\.be|be\\.com)/|(?:www\\.|m\\.)?soundcloud\\.com/|on\\.soundcloud\\.com/)[^$WS<>\"']+",
)
private val wikipediaLink = rx("^https://(?:[a-z0-9-]+\\.)+wikipedia\\.org/wiki/[^$WS]+$")
private val wikidataLink = rx("^https://(?:www\\.|m\\.)?wikidata\\.org/wiki/Q[1-9]\\p{Nd}*$")
private val lineBreak = Regex("[\\n\\u000B\\u000C\\r\\u0085\\u2028\\u2029]")

/** What a SoundCloud link points at. Ports `SoundcloudLink` of `ios/Sources/TagLogic.swift`. */
sealed interface SoundcloudLink {
    /** One track, with its canonical `https://soundcloud.com/<user>/<track>` address. */
    data class Track(val url: String) : SoundcloudLink

    /** A short `on.soundcloud.com` link the server has to follow. */
    data class Short(val url: String) : SoundcloudLink

    /** A SoundCloud page that is not a single track (a set, a profile, ...). */
    data object Unsupported : SoundcloudLink
}

/** Says what kind of SoundCloud link [input] is; null when it is not a SoundCloud link at all. */
fun classifySoundcloud(input: String): SoundcloudLink? {
    val text = input.trimWhitespace()
    val m = linkShape.find(text) ?: return null
    val host = m.groupValues[1].lowercase()
    val parts = m.groupValues[2].split("/").filter { it.isNotEmpty() }
    if (host == "on.soundcloud.com") {
        return if (parts.size == 1 && soundcloudShortCode.containsMatchIn(parts[0])) {
            SoundcloudLink.Short("https://on.soundcloud.com/${parts[0]}")
        } else {
            SoundcloudLink.Unsupported
        }
    }
    if (host !in soundcloudHosts) return null
    if (parts.size != 2 && parts.size != 3) return SoundcloudLink.Unsupported
    if (parts[0].lowercase() in soundcloudReservedUsers || parts[1].lowercase() in soundcloudReservedSecond ||
        !soundcloudName.containsMatchIn(parts[0]) || !soundcloudName.containsMatchIn(parts[1])
    ) {
        return SoundcloudLink.Unsupported
    }
    var url = "https://soundcloud.com/${parts[0]}/${parts[1]}"
    if (parts.size == 3) {
        if (!soundcloudSecret.containsMatchIn(parts[2])) return SoundcloudLink.Unsupported
        url += "/${parts[2]}"
    }
    return SoundcloudLink.Track(url)
}

/** The source named by a song id: `soundcloud-<id>`, `spotify-<id>`, `applemusic-<id>`, `shazam-<id>`, else "youtube". */
fun sourceOf(id: String): String {
    if (soundcloudId.containsMatchIn(id)) return "soundcloud"
    for (s in listOf("spotify", "applemusic", "shazam")) if (id.startsWith("$s-")) return s
    return "youtube"
}

/** The name of a source as people read it ("SoundCloud", "Apple Music"); anything unknown is "YouTube". */
fun sourceLabel(source: String?): String = when (source) {
    "soundcloud" -> "SoundCloud"
    "spotify" -> "Spotify"
    "applemusic" -> "Apple Music"
    "shazam" -> "Shazam"
    else -> "YouTube"
}

/** The source a song came from, read from its id (Swift `Track.source`). */
val Song.source: String get() = sourceOf(id)

/**
 * Turns a typed or pasted link into its clean form: a YouTube id or link becomes the plain watch link, a SoundCloud
 * track its canonical link, and any other http(s) link loses its tracking parameters. Other text comes back trimmed.
 *
 * Difference from Swift: the last step there goes through `URLComponents`; here the query is cut by hand, and a link
 * with white space inside is returned as it is.
 */
fun cleanUrl(input: String): String {
    val text = input.trimWhitespace()
    if (youtubeId.containsMatchIn(text)) return "https://www.youtube.com/watch?v=$text"
    for (p in youtubePatterns) p.find(text)?.let { return "https://www.youtube.com/watch?v=${it.groupValues[1]}" }
    when (val sc = classifySoundcloud(text)) {
        is SoundcloudLink.Track -> return sc.url
        is SoundcloudLink.Short -> return sc.url
        else -> Unit
    }
    val lower = text.lowercase()
    if (!lower.startsWith("http:") && !lower.startsWith("https:")) return text
    if (text.codePoints().anyMatch(::isUnicodeWhitespace)) return text
    val hash = text.indexOf('#')
    val main = if (hash < 0) text else text.substring(0, hash)
    val fragment = if (hash < 0) "" else text.substring(hash)
    val mark = main.indexOf('?')
    if (mark < 0 || mark == main.length - 1) return text
    val kept = main.substring(mark + 1).split("&").filter {
        val k = it.substringBefore("=").lowercase()
        k !in trackingParams && !k.startsWith("utm_")
    }
    return main.substring(0, mark) + (if (kept.isEmpty()) "" else "?" + kept.joinToString("&")) + fragment
}

/** [cleanUrl] for pasted text: the first link found anywhere in it, else its first line. */
fun cleanPasted(input: String): String {
    val text = input.trimWhitespace()
    pastedLink.find(text)?.let { return cleanUrl(it.value) }
    return cleanUrl(text.split(lineBreak).firstOrNull() ?: text)
}

/** True for a Wikipedia article link or a Wikidata item link, the two forms the song form accepts. */
fun isWikiLink(v: String): Boolean = wikipediaLink.containsMatchIn(v) || wikidataLink.containsMatchIn(v)

/** A tag cut at its first colon. [key] is empty for a plain tag (and for one that starts with a colon). */
data class TagParts(val key: String, val value: String)

/** Splits `genre:house` into key "genre" and value "house"; a plain tag has an empty key. */
fun splitTag(tag: String): TagParts {
    val i = tag.indexOf(':')
    return if (i <= 0) TagParts("", tag) else TagParts(tag.substring(0, i), tag.substring(i + 1))
}

/** The current calendar year on this device. */
fun currentYear(): Int = Year.now().value

/** Latest allowed release year: the current year plus one (as `maxYear` in the web and `max_year` on the server). */
fun maxReleaseYear(currentYear: Int = currentYear()): Int = currentYear + 1

/**
 * The `decade:NNs` tag of a year, or null for no year or one outside 1950..[maxReleaseYear].
 * Swift takes `now: Date`; here the clock is passed as [currentYear] so the function stays pure.
 */
fun decadeTag(year: Int?, currentYear: Int = currentYear()): String? {
    if (year == null || year !in 1950..maxReleaseYear(currentYear)) return null
    return String.format(Locale.ROOT, "decade:%02ds", year % 100 - year % 10)
}

/** The year a song is shown with and its decade follows: its version's year when the version has one, else the release year. */
fun displayYear(year: Int?, versionYear: Int?): Int? = versionYear ?: year

/** [tags] with the decade tag that [year] gives: it replaces any `decade:` tag in place, or is added at the end. */
fun withDecade(tags: List<String>, year: Int?, currentYear: Int = currentYear()): List<String> {
    val derived = decadeTag(year, currentYear) ?: return tags
    val out = mutableListOf<String>()
    var placed = false
    for (t in tags) {
        if (t.lowercase().startsWith("decade:")) {
            if (!placed) out.add(derived)
            placed = true
        } else {
            out.add(t)
        }
    }
    return if (placed) out else out + derived
}

/** Sort position of a decade tag in time order (50s..90s, then 00s..40s); 999 for anything else. */
fun decadeRank(tag: String): Int {
    val n = splitTag(tag).value.take(2).toIntOrNull() ?: return 999
    return if (n < 50) n + 100 else n
}

/** A typed tag trimmed, or "" while it is unfinished (`genre:` without a value, or nothing before the colon). */
fun completeTag(raw: String): String {
    val t = raw.trimSpaces()
    if (t.isEmpty()) return ""
    val i = t.indexOf(':')
    if (i < 0) return t
    val k = t.substring(0, i).trimSpaces()
    val v = t.substring(i + 1).trimSpaces()
    return if (k.isNotEmpty() && v.isNotEmpty()) t else ""
}

/** What [splitTagInput] gives: the finished tags and the unfinished remainder to leave in the field. */
data class TagInput(val tags: List<String>, val rest: String)

/** Splits comma-separated input into finished tags and the unfinished remainder (web/js/tag-input.js). */
fun splitTagInput(raw: String): TagInput {
    val parts = raw.split(",").map { it.trimSpaces() }.filter { it.isNotEmpty() }
    return TagInput(
        parts.map(::completeTag).filter { it.isNotEmpty() },
        parts.filter { completeTag(it).isEmpty() }.joinToString(", "),
    )
}

/** A tag and how many songs carry it. */
data class TagCount(val tag: String, val count: Int)

/** Tags of one namespace under a heading ("Genre", "Decade", "Tags"), for a grouped tag list. */
data class TagGroup(val key: String, val name: String, val tags: List<TagCount>)

/**
 * Groups counted tags by namespace: genre, decade and country first, other namespaces by name, plain tags last;
 * `lang:` tags are left out. Decades run in time order, the rest by label.
 *
 * Difference from Swift: labels are ordered there with `localizedCompare` (the device's collation); here by their
 * case- and accent-blind form, then by the label itself.
 */
fun tagGroups(counts: List<TagCount>): List<TagGroup> {
    val shown = counts.filter { splitTag(it.tag).key.lowercase() != "lang" }
    val names = mapOf("decade" to "Decade", "country" to "Country")
    val first = listOf("genre", "decade", "country")
    val groups = shown.groupBy { splitTag(it.tag).key }
    fun rank(k: String) = if (k.isEmpty()) 2 else if (k in first) 0 else 1
    val order = groups.keys.sortedWith(
        compareBy<String> { rank(it) }.thenBy { if (rank(it) == 0) first.indexOf(it) else 0 }.thenBy { it },
    )
    return order.map { key ->
        val name = if (key.isEmpty()) "Tags" else names[key] ?: (key.take(1).uppercase() + key.drop(1))
        val sorted = if (key == "decade") {
            groups.getValue(key).sortedWith(compareBy<TagCount> { decadeRank(it.tag) }.thenBy { it.tag })
        } else {
            groups.getValue(key).sortedWith(compareBy<TagCount> { foldText(tagLabel(it.tag)) }.thenBy { tagLabel(it.tag) })
        }
        TagGroup(key, name, sorted)
    }
}

/** Counts every tag over the songs' tag lists, case-blind (the first spelling seen is kept), ordered by tag. */
fun tagCounts(songTags: List<List<String>>): List<TagCount> {
    val map = LinkedHashMap<String, TagCount>()
    for (tags in songTags) {
        for (t in tags) {
            val k = t.lowercase()
            val had = map[k]
            map[k] = TagCount(had?.tag ?: t, (had?.count ?: 0) + 1)
        }
    }
    return map.values.sortedBy { it.tag }
}

private fun regionName(code: String): String? {
    val upper = code.uppercase(Locale.ROOT)
    val locale = try {
        Locale.Builder().setRegion(upper).build()
    } catch (_: IllformedLocaleException) {
        return null
    }
    return locale.getDisplayCountry(Locale.ENGLISH).takeIf { it.isNotEmpty() && it != upper }
}

private fun languageName(code: String): String? {
    val locale = try {
        Locale.Builder().setLanguage(code).build()
    } catch (_: IllformedLocaleException) {
        return null
    }
    return locale.getDisplayLanguage(Locale.ENGLISH).takeIf { it.isNotEmpty() && !it.equals(code, ignoreCase = true) }
}

/**
 * A tag as people read it: `decade:90s` is "the 90s", `country:lt` is "Lithuania", `lang:de` is "German",
 * any other namespaced tag shows its value, a plain tag shows itself.
 *
 * Difference from Swift: country and language names come from this platform's locale data (the JDK in unit tests,
 * ICU on Android), which can word a few names differently from Apple's ("Türkiye" and "Turkey", for example).
 */
fun tagLabel(tag: String): String {
    val (key, value) = splitTag(tag)
    if (key.isEmpty()) return tag
    return when (key) {
        "decade" -> "the $value"
        "country" -> regionName(value) ?: value
        "lang" -> languageName(value) ?: value
        else -> value
    }
}

/** The namespace of a tag in lower case ("" for a plain tag). */
fun tagKey(tag: String): String = splitTag(tag).key.lowercase()

/** The most `genre:` tags a song may carry. */
const val GENRE_CAP = 12

/** The most `country:` tags a song may carry. */
const val COUNTRY_CAP = 1

/** ISO alpha-2 code (lower case) for a typed country name or code; null when unknown. */
fun countryCode(raw: String): String? {
    val t = raw.trimSpaces()
    if (t.isEmpty()) return null
    val codes = Locale.getISOCountries()
    if (t.length == 2 && t.uppercase(Locale.ROOT) in codes) return t.lowercase(Locale.ROOT)
    return codes.firstOrNull { regionName(it)?.equals(t, ignoreCase = true) == true }?.lowercase(Locale.ROOT)
}

/** True when [tags] holds [tag], case-blind. */
fun hasTag(tags: List<String>, tag: String): Boolean = tags.any { it.lowercase() == tag.lowercase() }

/**
 * [tags] plus the `genre:` and `country:` tags of [candidates] that fit: duplicates are skipped and the caps
 * ([GENRE_CAP], [COUNTRY_CAP]) hold. Added tags are lower-cased.
 * Swift changes the list in place and returns the count; here the count is `result.size - tags.size`.
 */
fun addNamespaced(tags: List<String>, candidates: List<String>): List<String> {
    val out = tags.toMutableList()
    for (t in candidates) {
        val k = tagKey(t)
        if ((k != "genre" && k != "country") || hasTag(out, t)) continue
        val have = out.count { tagKey(it) == k }
        if (have >= (if (k == "genre") GENRE_CAP else COUNTRY_CAP)) continue
        out.add(t.lowercase())
    }
    return out
}

private fun canonicalSoundcloud(text: String): String? = (classifySoundcloud(text) as? SoundcloudLink.Track)?.url?.lowercase()

/** The library song a pasted link points at, found without the network: YouTube by video id, SoundCloud by canonical URL. */
fun libraryMatch(link: String, songs: List<Song>): Song? {
    val text = cleanPasted(link)
    if (text.isEmpty()) return null
    for (p in youtubePatterns) {
        val vid = p.find(text)?.groupValues?.get(1) ?: continue
        return songs.firstOrNull { s -> s.id == vid || s.sources.orEmpty().any { it.source == "youtube" && it.id == vid } }
    }
    val want = canonicalSoundcloud(text) ?: return null
    return songs.firstOrNull { s ->
        (listOf(s.sourceURL) + s.sources.orEmpty().map { it.url }).any { it != null && canonicalSoundcloud(it) == want }
    }
}
