package com.alexisayenko.audioplayer.android.logic

import com.alexisayenko.audioplayer.android.model.Song

/**
 * What the Library screen is asked to show: the search text, the picked chip values, the two toggles and the order.
 * Immutable: every change gives a new query, so it can sit in a `StateFlow` or `rememberSaveable` state.
 *
 * Ports `LibraryQuery` of `ios/Sources/LibraryQuery.swift`. There the object also writes the sort to UserDefaults;
 * here storing is the caller's job: keep `sort.label` and `reversed`, and rebuild with [restored] on launch
 * (only sort and direction survive a relaunch, the narrowing never does).
 */
data class LibraryQuery(
    val search: String = "",
    /** Picked chip values as [LibraryFacet] keys (`genre:house`, `era:1990`, ...). */
    val selection: Set<String> = emptySet(),
    val neverListened: Boolean = false,
    val downloadedOnly: Boolean = false,
    val sort: LibrarySort = LibrarySort.Newest,
    val reversed: Boolean = false,
) {
    /** True while anything narrows the list (search, chips or toggles); the screen then offers "Clear". */
    val narrowing: Boolean get() = search.isNotEmpty() || selection.isNotEmpty() || neverListened || downloadedOnly

    /** Drops the search, the chips and the toggles; the sort and its direction stay. */
    fun clear(): LibraryQuery = copy(search = "", selection = emptySet(), neverListened = false, downloadedOnly = false)

    /** Picks a sort order. A new order starts in its natural direction; picking the current one changes nothing. */
    fun choose(criterion: LibrarySort): LibraryQuery = if (criterion == sort) this else copy(sort = criterion, reversed = false)

    /** Adds the chip value [key] to the selection, or removes it when it is already picked. */
    fun toggle(key: String): LibraryQuery = copy(selection = if (key in selection) selection - key else selection + key)

    /** The picked values of one chip. */
    fun selected(facet: LibraryFacet): Set<String> = selection.filter { it.startsWith(facet.prefix) }.toSet()

    /**
     * The songs to list: [songs] filtered by this query and put in its order.
     * [phoneIds] are the ids with audio on the phone (for "Downloaded"); [listening] is the server's listening
     * summary by song id (for "Never listened" and "Last listened"), empty when not loaded.
     */
    fun results(
        songs: List<Song>,
        phoneIds: Set<String>,
        listening: Map<String, LibraryListeningEntry> = emptyMap(),
    ): List<Song> {
        val matches = LibraryMatching.filtered(songs, search, selection, neverListened, downloadedOnly, phoneIds, listening)
        return LibraryMatching.sorted(matches, sort, reversed, listening)
    }

    companion object {
        /** The query of a fresh launch from the stored sort label and direction; an unknown label gives the default sort. */
        fun restored(sortLabel: String?, reversed: Boolean): LibraryQuery =
            LibraryQuery(sort = LibrarySort.fromLabel(sortLabel) ?: LibrarySort.Newest, reversed = reversed)
    }
}

/**
 * Remembers the last [LibraryQuery.results] so a screen that asks on every refresh runs the filter and the sort again
 * only when the query or the data changed. The caller says which data it has through a [DataStamp]: equal stamps
 * mean equal songs, phone ids and listening data. Not thread-safe; use it from one thread.
 *
 * Ports the memoized `results(_:phoneIDs:listening:stamp:)` of `ios/Sources/LibraryQuery.swift`.
 */
class LibraryResultsMemo {
    /** Which data the result was computed from: the stores count their changes. */
    data class DataStamp(val phoneOnly: Boolean, val library: Int, val listening: Int)

    private var memo: Triple<LibraryQuery, DataStamp, List<Song>>? = null

    /** How many times the filter and sort really ran. */
    var computed: Int = 0
        private set

    /** The results for [query]; [songs] is read only when they have to be computed again. */
    fun results(
        query: LibraryQuery,
        songs: () -> List<Song>,
        phoneIds: Set<String>,
        listening: Map<String, LibraryListeningEntry>,
        stamp: DataStamp,
    ): List<Song> {
        memo?.let { (q, s, value) -> if (q == query && s == stamp) return value }
        computed += 1
        val value = query.results(songs(), phoneIds, listening)
        memo = Triple(query, stamp, value)
        return value
    }
}
