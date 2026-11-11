package com.alexisayenko.audioplayer.android.logic

/** How many genre suggestions are offered at most. */
const val GENRE_SUGGEST_MAX = 6

private val nonWord = Regex("[^\\p{L}\\p{N}]+")

private fun foldGenre(s: String): String = foldText(s).trimSpaces()

/**
 * Genres to offer while [query] is typed: first those that start with it, then those with a word that starts with
 * it, then those that contain it; case- and accent-blind, without the ones in [chosen], at most [max].
 * Ports `suggestGenres` of `ios/Sources/GenreSuggest.swift`.
 */
fun suggestGenres(query: String, genres: List<String>, chosen: List<String> = emptyList(), max: Int = GENRE_SUGGEST_MAX): List<String> {
    val q = foldGenre(query)
    if (q.isEmpty()) return emptyList()
    val taken = chosen.map(::foldGenre).toMutableSet()
    val starts = mutableListOf<String>()
    val words = mutableListOf<String>()
    val inside = mutableListOf<String>()
    for (g in genres) {
        val f = foldGenre(g)
        if (f.isEmpty() || !taken.add(f)) continue
        when {
            f.startsWith(q) -> starts.add(g)
            f.split(nonWord).any { it.startsWith(q) } -> words.add(g)
            f.contains(q) -> inside.add(g)
        }
    }
    return (starts + words + inside).take(max)
}

/**
 * The genres used in a library, read from the `genre:` tags of every song: lower case, most used first,
 * ties in the order first seen. Ports `genresFromTags` of `ios/Sources/GenreSuggest.swift`.
 */
fun genresFromTags(tagLists: List<List<String>>): List<String> {
    val counts = LinkedHashMap<String, Int>()
    for (tags in tagLists) {
        for (t in tags) {
            if (!t.lowercase().startsWith("genre:")) continue
            val v = t.drop(6).lowercase().trimSpaces()
            if (v.isNotEmpty()) counts[v] = (counts[v] ?: 0) + 1
        }
    }
    return counts.entries.sortedByDescending { it.value }.map { it.key }
}
