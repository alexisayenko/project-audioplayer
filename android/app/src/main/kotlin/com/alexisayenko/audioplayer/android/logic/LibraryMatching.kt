package com.alexisayenko.audioplayer.android.logic

import com.alexisayenko.audioplayer.android.model.Song
import java.util.Locale
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Library search, filters and sorting: ports of `ios/Sources/LibraryMatching.swift` and
 * `ios/Sources/LibraryFilterModel.swift`. (`ios/Sources/LibraryFilter.swift` holds only a SwiftUI button style and
 * has nothing to port; the SF Symbol names of the Swift enums are left to the UI.)
 */

/** The orders the Library can be sorted in. [label] is the menu text and the value to store between runs. */
enum class LibrarySort(val label: String) {
    Newest("Recently added"),
    Title("Title"),
    Artist("Artist"),
    Year("Year"),
    Bpm("BPM"),
    Length("Length"),
    Listened("Last listened"),
    ;

    /** True when the natural direction of this order is highest or latest first. */
    val descending: Boolean get() = this == Newest || this == Year || this == Listened

    companion object {
        /** The sort with this stored [label], or null (Swift `LibrarySort(rawValue:)`). */
        fun fromLabel(label: String?): LibrarySort? = entries.firstOrNull { it.label == label }
    }
}

/** One choice of a Library filter chip: its key (what the selection stores), its text and how many songs have it. */
data class LibraryFacetValue(val id: String, val label: String, val count: Int)

/**
 * The four filter chips of the Library. A selected value is a key such as `genre:house`, `era:1990`,
 * `country:lt` or `tags:live`; every facet also has an "Unknown" value ([unknown]) except Tags.
 */
enum class LibraryFacet(val label: String, val prefix: String, val noun: String) {
    Tags("Tags", "tags:", "tag"),
    Genres("Genres", "genre:", "genre"),
    Era("Era", "era:", "decade"),
    Countries("Countries", "country:", "country"),
    ;

    /** The heading of the chip's picker ("Decades" for Era). */
    val title: String get() = if (this == Era) "Decades" else label

    /** The key of "songs with no value for this facet". */
    val unknown: String get() = prefix + "__unset__"

    /** [noun] in the right number: "1 genre", "2 genres", "2 countries". */
    fun noun(n: Int): String = if (n == 1) noun else if (this == Countries) "countries" else noun + "s"

    /** The keys of this facet that [song] falls under. */
    fun keys(song: Song): Set<String> {
        if (this == Era) return setOf(song.libraryYear?.let { prefix + (it / 10) * 10 } ?: unknown)
        val keys = mutableSetOf<String>()
        for (tag in song.tags.orEmpty()) {
            val part = splitTag(tag)
            val key = part.key.lowercase()
            when (this) {
                Tags -> if (key !in reservedNamespaces) keys.add(prefix + tag.lowercase())
                Genres -> if (key == "genre" && part.value.isNotEmpty()) keys.add(prefix + part.value.lowercase())
                Countries -> if (key == "country" && part.value.isNotEmpty()) keys.add(prefix + part.value.lowercase())
                Era -> Unit
            }
        }
        if (this == Genres) song.genres.orEmpty().filter { it.isNotEmpty() }.mapTo(keys) { prefix + it.lowercase() }
        if (keys.isEmpty() && this != Tags) keys.add(unknown)
        return keys
    }

    /** The text of a key: "Unknown", "’90s", a country name, a genre or a tag. */
    fun label(key: String): String {
        if (key == unknown) return "Unknown"
        val value = key.drop(prefix.length)
        if (this == Era) value.toIntOrNull()?.let { return String.format(Locale.ROOT, "’%02ds", (it % 100 + 100) % 100) }
        return if (this == Tags) tagLabel(value) else tagLabel(key)
    }

    /**
     * Every value of this facet found in [songs] with its count: decades newest first, the others most used first
     * (ties by label), "Unknown" always last.
     */
    fun values(songs: List<Song>): List<LibraryFacetValue> {
        val counts = LinkedHashMap<String, Int>()
        val labels = HashMap<String, String>()
        for (song in songs) {
            for (key in keys(song)) counts[key] = (counts[key] ?: 0) + 1
            for (tag in song.tags.orEmpty()) {
                val part = splitTag(tag)
                if (this == Tags && part.key.lowercase() !in reservedNamespaces) {
                    labels.getOrPut(prefix + tag.lowercase()) { tagLabel(tag) }
                } else if (this == Genres && part.key.lowercase() == "genre") {
                    labels.getOrPut(prefix + part.value.lowercase()) { part.value }
                }
            }
            if (this == Genres) for (genre in song.genres.orEmpty()) labels.getOrPut(prefix + genre.lowercase()) { genre }
        }
        val order = Comparator<LibraryFacetValue> { a, b ->
            when {
                a.id == b.id -> 0
                a.id == unknown -> 1
                b.id == unknown -> -1
                this == Era -> (b.id.drop(prefix.length).toIntOrNull() ?: 0).compareTo(a.id.drop(prefix.length).toIntOrNull() ?: 0)
                a.count != b.count -> b.count.compareTo(a.count)
                else -> LibraryMatching.compare(a.label, b.label)
            }
        }
        return counts.map { (key, count) -> LibraryFacetValue(key, labels[key] ?: label(key), count) }.sortedWith(order)
    }

    private companion object {
        val reservedNamespaces = setOf("genre", "decade", "country", "lang")
    }
}

/**
 * One song's entry of the server's listening summary, as far as the Library needs it: the "Never listened" chip and
 * the "Last listened" sort. Decodes the server's snake_case JSON (Swift `LibraryListeningEntry`).
 */
@Serializable
data class LibraryListeningEntry(
    val listened: Counts? = null,
    val skipped: Counts? = null,
    @SerialName("total_listened_s") val totalListenedS: Double? = null,
    /** ISO date of the last listen; such dates sort as text. */
    @SerialName("last_listened") val lastListened: String? = null,
) {
    /** Play counts over all time and over the last 30 days. */
    @Serializable
    data class Counts(val all: Int? = null, val d30: Int? = null)

    /** True when the song was neither listened to nor skipped. */
    val never: Boolean get() = (listened?.all ?: 0) + (skipped?.all ?: 0) == 0
}

/** The Library's search, filter and sort rules as pure functions. */
object LibraryMatching {
    /**
     * Case- and accent-blind form of [text] used by search and sorting.
     * Swift folds with Foundation (`en_US_POSIX`); this uses `java.text.Normalizer` (NFD, combining marks dropped)
     * and a locale-free lower case. They differ only where case folding is not lower-casing ("ß" stays "ß" here).
     */
    fun folded(text: String): String = foldText(text)

    /** Orders two texts by their folded forms: negative, zero or positive as [a] sorts before, with or after [b]. */
    fun compare(a: String, b: String): Int = folded(a).compareTo(folded(b))

    /**
     * The songs that pass the search text and the chips. Values picked inside one facet are alternatives (OR);
     * facets, the search and the toggles narrow each other (AND). A song without a listening entry counts as never
     * listened.
     */
    fun filtered(
        songs: List<Song>,
        search: String,
        selection: Set<String>,
        neverListened: Boolean,
        downloadedOnly: Boolean,
        phoneIds: Set<String>,
        listening: Map<String, LibraryListeningEntry>,
    ): List<Song> {
        val q = folded(search.trimWhitespace())
        val groups = LibraryFacet.entries.map { facet -> facet to selection.filter { it.startsWith(facet.prefix) }.toSet() }
            .filter { it.second.isNotEmpty() }
        return songs.filter { song ->
            if (downloadedOnly && song.id !in phoneIds) return@filter false
            if (neverListened && listening[song.id]?.never == false) return@filter false
            for ((facet, picked) in groups) {
                if (facet.keys(song).none { it in picked }) return@filter false
            }
            q.isEmpty() || song.librarySearchTerms.any { folded(it).contains(q) }
        }
    }

    /**
     * [songs] in the chosen order. Songs that lack the sort value (no year, no BPM, never listened, ...) stay last
     * in both directions; ties go by title, then by id, so the order is stable.
     */
    fun sorted(
        songs: List<Song>,
        sort: LibrarySort,
        reversed: Boolean,
        listening: Map<String, LibraryListeningEntry>,
    ): List<Song> {
        // Folding is the costly part of a comparison, so each title is folded once.
        val order = Comparator<Pair<Song, String>> { (a, titleA), (b, titleB) ->
            var result = when (sort) {
                LibrarySort.Title -> titleA.compareTo(titleB)
                LibrarySort.Artist -> optionalCompare(a.librarySortArtist, b.librarySortArtist, reversed, descending = false)
                LibrarySort.Newest -> optionalCompare(a.addedAt, b.addedAt, reversed, descending = true)
                LibrarySort.Year -> optionalCompare(a.libraryYear, b.libraryYear, reversed, descending = true)
                LibrarySort.Bpm -> optionalCompare(a.bpm?.takeIf { it.isFinite() }, b.bpm?.takeIf { it.isFinite() }, reversed, descending = false)
                LibrarySort.Length -> optionalCompare(a.sortLength, b.sortLength, reversed, descending = false)
                LibrarySort.Listened ->
                    optionalCompare(listening[a.id]?.lastListened, listening[b.id]?.lastListened, reversed, descending = true)
            }
            // Optional keys already apply direction while keeping missing values last.
            if (sort == LibrarySort.Title && reversed) result = -result
            if (result == 0) result = titleA.compareTo(titleB)
            if (result == 0) a.id.compareTo(b.id) else result
        }
        return songs.map { it to folded(it.title) }.sortedWith(order).map { it.first }
    }

    private val Song.sortLength: Double? get() = duration?.takeIf { it > 0 && it.isFinite() }

    private fun <T : Comparable<T>> optionalCompare(a: T?, b: T?, reversed: Boolean, descending: Boolean): Int {
        if (a == null) return if (b == null) 0 else 1
        if (b == null) return -1
        val result = a.compareTo(b).coerceIn(-1, 1)
        return if (descending != reversed) -result else result
    }
}

/** Match web credits.js: remasters retain their original release year; other versions and remixes show their own. */
val Song.libraryYear: Int?
    get() {
        val original = releaseYear ?: year
        return if (version?.type?.lowercase() == "remaster") original else version?.releaseYear ?: remixYear ?: original
    }

/** The artist text of a song: "A & B feat. C with D" from the structured credits, else the plain `artist` field. */
val Song.libraryArtist: String
    get() {
        val main = mainArtists ?: return artist
        val parts = mutableListOf(main.joinToString(" & "))
        featuredArtists?.takeIf { it.isNotEmpty() }?.let { parts.add("feat. " + it.joinToString(" & ")) }
        withArtists?.takeIf { it.isNotEmpty() }?.let { parts.add("with " + it.joinToString(" & ")) }
        return parts.filter { it.isNotEmpty() }.joinToString(" ")
    }

/** What the Artist sort goes by: the first main artist (or `artist`), folded; null when there is none. */
val Song.librarySortArtist: String?
    get() {
        val text = (mainArtists?.firstOrNull() ?: artist).trimWhitespace()
        return if (text.isEmpty()) null else LibraryMatching.folded(text)
    }

/** The second line of a song row: "Artist · year", either part left out when missing. */
val Song.librarySubtitle: String
    get() = listOf(libraryArtist, libraryYear?.toString().orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ")

/** Every text the Library search looks in: names, credits, albums, genres, tags and their labels. */
val Song.librarySearchTerms: List<String>
    get() = buildList {
        add(title)
        add(artist)
        add(album.orEmpty())
        add(remixer.orEmpty())
        add(version?.name.orEmpty())
        addAll(mainArtists.orEmpty())
        addAll(featuredArtists.orEmpty())
        addAll(withArtists.orEmpty())
        addAll(version?.artists.orEmpty())
        addAll(albums.orEmpty())
        addAll(genres.orEmpty())
        for (tag in tags.orEmpty()) {
            add(tag)
            add(tagLabel(tag))
        }
    }

/**
 * The older tag-only filter chips (Tags, Genres, Years, Countries) that work on raw tags; the iPhone Library uses
 * [LibraryFacet] instead and the Mac app still uses this one. Ports `FilterCategory` of
 * `ios/Sources/LibraryFilterModel.swift`.
 */
enum class FilterCategory(val label: String) {
    Tags("Tags"),
    Genres("Genres"),
    Years("Years"),
    Countries("Countries"),
    ;

    /** True when [tag] belongs under this chip. Plain tags fold into Tags; `lang:` tags belong nowhere. */
    fun owns(tag: String): Boolean = when (val key = splitTag(tag).key.lowercase()) {
        "genre" -> this == Genres
        "decade" -> this == Years
        "country" -> this == Countries
        else -> this == Tags && key != "lang"
    }

    /** This chip's tags out of [counts]: decades in time order, the rest by label (case-blind). */
    fun values(counts: List<TagCount>): List<TagCount> {
        val mine = counts.filter { owns(it.tag) }
        return if (this == Years) {
            mine.sortedWith(compareBy<TagCount> { decadeRank(it.tag) }.thenBy { it.tag })
        } else {
            mine.sortedBy { foldText(tagLabel(it.tag)) }
        }
    }
}

/** Values inside a category are alternatives; categories narrow each other. [selection] holds lower-case tags. */
fun tagFilterMatches(song: Song, selection: Set<String>): Boolean {
    if (selection.isEmpty()) return true
    val tags = song.tags.orEmpty().map { it.lowercase() }.toSet()
    for (category in FilterCategory.entries) {
        val picked = selection.filter { category.owns(it) }
        if (picked.isNotEmpty() && picked.none { it in tags }) return false
    }
    return true
}
