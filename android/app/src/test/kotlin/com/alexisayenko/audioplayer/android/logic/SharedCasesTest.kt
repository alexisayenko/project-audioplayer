package com.alexisayenko.audioplayer.android.logic

import com.alexisayenko.audioplayer.android.model.Song
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* Mirrors `ios/Tests/SharedCasesTests.swift`: the same case files, read in place from `server/tests/fixtures`. */

internal val fixtureJson = Json { ignoreUnknownKeys = true }

internal inline fun <reified T> fixture(name: String): T {
    val url = checkNotNull(SharedFixtures::class.java.classLoader?.getResource("$name.json")) {
        "$name.json is not on the test classpath"
    }
    return fixtureJson.decodeFromString(url.readText(Charsets.UTF_8))
}

internal object SharedFixtures

@Serializable
private data class Piece(val text: String, val sep: String)

@Serializable
private data class TokenCase(val input: String, val tokenize: List<Piece>, val split: List<String>, val join: String)

@Serializable
private data class IOCase(val input: String, val output: String)

@Serializable
private data class SoundcloudCase(val input: String, val kind: String? = null, val url: String)

@Serializable
private data class SourceCase(val id: String, val source: String)

@Serializable
private data class UrlCases(
    val clean: List<IOCase>,
    val pasted: List<IOCase>,
    val soundcloud: List<SoundcloudCase>,
    val source_of: List<SourceCase>,
)

@Serializable
private data class SplitTagCase(val tag: String, val key: String, val value: String)

@Serializable
private data class DecadeCase(val year: Int? = null, val tag: String? = null)

@Serializable
private data class RankCase(val tag: String, val rank: Int)

@Serializable
private data class SplitInputCase(val input: String, val tags: List<String>, val rest: String)

@Serializable
private data class TagCases(
    val split_tag: List<SplitTagCase>,
    val decade_tag: List<DecadeCase>,
    val decade_rank: List<RankCase>,
    val complete_tag: List<IOCase>,
    val split_input: List<SplitInputCase>,
)

private fun trimmed(s: String): String {
    val cps = s.codePoints().toArray()
    var from = 0
    var to = cps.size
    fun space(cp: Int) = isUnicodeWhitespace(cp) || cp == 0xFEFF
    while (from < to && space(cps[from])) from += 1
    while (to > from && space(cps[to - 1])) to -= 1
    return String(cps, from, to - from)
}

class TokenCasesTest {
    @Test
    fun theSharedCasesMatchTheWebTokenizer() {
        val cases = fixture<List<TokenCase>>("token_cases")
        assertTrue(cases.size >= 60)
        for (c in cases) {
            val toks = Tokens.tokenize(c.input)
            assertEquals(c.input, c.tokenize, toks.map { Piece(it.text, it.sep) })
            val split = toks.map { trimmed(it.text) }.filter { it.isNotEmpty() }
            assertEquals(c.input, c.split, split)
            assertEquals(c.input, c.join, c.split.map(::trimmed).filter { it.isNotEmpty() }.joinToString(" - "))
            assertEquals(c.input, c.input, Tokens.compose(toks))
        }
    }
}

class UrlCleanCasesTest {
    private fun cases() = fixture<UrlCases>("url_clean_cases")

    @Test
    fun cleanUrlMatchesTheSharedCases() {
        val cases = cases().clean
        assertTrue(cases.isNotEmpty())
        for (c in cases) assertEquals(c.input, c.output, cleanUrl(c.input))
    }

    @Test
    fun cleanPastedMatchesTheSharedCases() {
        val cases = cases().pasted
        assertTrue(cases.isNotEmpty())
        for (c in cases) assertEquals(c.input, c.output, cleanPasted(c.input))
    }

    @Test
    fun classifySoundcloudMatchesTheSharedCases() {
        val cases = cases().soundcloud
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val got: Pair<String, String>? = when (val link = classifySoundcloud(c.input)) {
                is SoundcloudLink.Track -> "track" to link.url
                is SoundcloudLink.Short -> "short" to link.url
                SoundcloudLink.Unsupported -> "unsupported" to ""
                null -> null
            }
            if (c.kind != null) {
                assertEquals(c.input, c.kind, got?.first)
                assertEquals(c.input, c.url, got?.second)
            } else {
                assertNull(c.input, got)
            }
        }
    }

    @Test
    fun sourceOfMatchesTheSharedCases() {
        val cases = cases().source_of
        assertTrue(cases.isNotEmpty())
        for (c in cases) assertEquals(c.id, c.source, sourceOf(c.id))
    }

    @Test
    fun libraryMatchFindsASongByAPastedLink() {
        val song = Song(id = "QCuUAClm-hQ", title = "T", artist = "A")
        assertEquals("QCuUAClm-hQ", libraryMatch("QCuUAClm-hQ", listOf(song))?.id)
        assertEquals("QCuUAClm-hQ", libraryMatch("https://youtu.be/QCuUAClm-hQ", listOf(song))?.id)
        assertNull(libraryMatch("QCuUAClm-h", listOf(song)))
    }
}

class TagCasesTest {
    private fun cases() = fixture<TagCases>("tag_cases")

    @Test
    fun splitTagMatchesTheSharedCases() {
        val cases = cases().split_tag
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val got = splitTag(c.tag)
            assertEquals(c.tag, c.key, got.key)
            assertEquals(c.tag, c.value, got.value)
        }
    }

    @Test
    fun decadeTagMatchesTheSharedCases() {
        val cases = cases().decade_tag
        assertTrue(cases.isNotEmpty())
        for (c in cases) assertEquals(c.year.toString(), c.tag, decadeTag(c.year))
    }

    @Test
    fun decadeTagFollowsTheCurrentYearPlusOneLikeTheWeb() {
        assertNull(decadeTag(2030, currentYear = 2026))
        assertEquals("decade:20s", decadeTag(2027, currentYear = 2026))
        assertEquals("decade:30s", decadeTag(2030, currentYear = 2029))
        assertNull(decadeTag(1949, currentYear = 2029))
        assertEquals("decade:70s", decadeTag(2170, currentYear = 2169))
        assertEquals(2027, maxReleaseYear(2026))
    }

    @Test
    fun withDecadeReplacesTheDerivedTagAndStopsAtTheLimit() {
        assertEquals(listOf("genre:house", "decade:30s"), withDecade(listOf("genre:house", "decade:20s"), 2031, currentYear = 2030))
        assertEquals(listOf("genre:house"), withDecade(listOf("genre:house"), 2032, currentYear = 2030))
    }

    @Test
    fun decadeRankMatchesTheSharedCases() {
        val cases = cases().decade_rank
        assertTrue(cases.isNotEmpty())
        for (c in cases) assertEquals(c.tag, c.rank, decadeRank(c.tag))
    }

    @Test
    fun completeTagMatchesTheSharedCases() {
        val cases = cases().complete_tag
        assertTrue(cases.isNotEmpty())
        for (c in cases) assertEquals(c.input, c.output, completeTag(c.input))
    }

    @Test
    fun splitTagInputMatchesTheSharedCases() {
        val cases = cases().split_input
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val got = splitTagInput(c.input)
            assertEquals(c.input, c.tags, got.tags)
            assertEquals(c.input, c.rest, got.rest)
        }
    }
}
