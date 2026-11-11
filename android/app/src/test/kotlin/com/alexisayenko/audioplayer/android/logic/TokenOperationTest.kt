package com.alexisayenko.audioplayer.android.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors `ios/Tests/TokenOperationTests.swift` case for case. */
class TokenOperationTest {
    private val sep = " - "

    private fun parts(s: String): List<String> = Tokens.parts(s)

    @Test
    fun splitsOnlyOnASpacedDash() {
        assertEquals(listOf("De Hofnar", "Zonnestraal"), parts("De Hofnar - Zonnestraal"))
        assertEquals(listOf("A", "B", "C"), parts("A – B — C"))
        assertEquals(listOf("A", "B"), parts("A  -  B"))
    }

    @Test
    fun commasSemicolonsAmpersandsAndUnspacedSeparatorsNeverSplit() {
        val whole = listOf(
            "Tyler, The Creator", "Earth, Wind & Fire", "A; B", "AC/DC", "24/7", "A|B", "A/ B", "A /B", "A feat. B", "A x B",
            "Dr. Dre", "Jean-Michel Jarre", "A -B", "A- B", "A–B",
        )
        for (s in whole) assertEquals(s, listOf(s), parts(s))
    }

    @Test
    fun threeTokensEdgesAndEmpty() {
        assertEquals(listOf("A", "B", "C"), parts("A - B - C"))
        assertEquals(listOf("A"), parts(" - A - "))
        assertEquals(listOf("A"), parts("A - "))
        assertEquals(emptyList<String>(), parts(""))
    }

    @Test
    fun roundTripLeavesEveryStringUntouched() {
        for (s in listOf("A, B", "A – B", "A  -  B", " - A - ", "A - ", "", "Artist | Title", "A ／／ B")) {
            assertEquals(s, s, Tokens.compose(Tokens.tokenize(s)))
        }
        assertEquals("A – B", Tokens.stripEdges("A – B"))
        assertEquals("Mix", Tokens.stripEdges("Mix - "))
        assertEquals("| A |", Tokens.stripEdges("| A |"))
    }

    @Test
    fun removeToken() {
        assertEquals("B - C", Tokens.removeToken("A - B - C", 0))
        assertEquals("A - C", Tokens.removeToken("A - B - C", 1))
        assertEquals("A - B", Tokens.removeToken("A - B - C", 2))
        assertEquals("", Tokens.removeToken("A, B", 0))
        assertEquals("", Tokens.removeToken("Solo", 0))
        assertEquals("A - B - C", Tokens.removeToken("A - B - C", 9))
    }

    @Test
    fun replaceTokenKeepsSeparators() {
        assertEquals("A – X", Tokens.replaceToken("A – B", 1, "X"))
        assertEquals("B", Tokens.replaceToken("A - B", 0, ""))
        assertEquals("Tyler, The Creator!", Tokens.replaceToken("Tyler, The Creator", 0, "Tyler, The Creator!"))
    }

    @Test
    fun appendTokenJoinsWithTheSeparator() {
        assertEquals("A", Tokens.appendToken("", "A", sep))
        assertEquals("A - B", Tokens.appendToken("A", "B", sep))
        assertEquals("A, B - C", Tokens.appendToken("A, B", "C", sep))
        assertEquals("A - B", Tokens.appendToken("A - ", "B", sep))
        assertEquals("A", Tokens.appendToken("A", "  ", sep))
        assertTrue(Tokens.endsWithSeparator("A - "))
        assertFalse(Tokens.endsWithSeparator("A, "))
    }

    @Test
    fun moveTokenBetweenFields() {
        val moved = Tokens.moveToken("De Hofnar - Zonnestraal", 0, "KAV", sep)
        assertEquals("Zonnestraal", moved.src)
        assertEquals("KAV - De Hofnar", moved.dst)
        val solo = Tokens.moveToken("Solo", 0, "", sep)
        assertEquals("", solo.src)
        assertEquals("Solo", solo.dst)
        val blank = Tokens.moveToken("A - ", 1, "X", sep)
        assertEquals("A - ", blank.src)
        assertEquals("X", blank.dst)
    }

    @Test
    fun commitTypedNeedsTheExactSeparator() {
        assertEquals(TypedCommit("", "A, B"), Tokens.commitTyped("", "A, B", sep))
        assertEquals(TypedCommit("", "A; B & C"), Tokens.commitTyped("", "A; B & C", sep))
        assertEquals(TypedCommit("A - ", "Bo"), Tokens.commitTyped("", "A - Bo", sep))
        assertEquals("X - A", Tokens.stripEdges(Tokens.commitTyped("X", "A - ", sep).value))
    }

    @Test
    fun insertTokenAndMoveTokenTo() {
        assertEquals("A - B - C", Tokens.insertToken("A - C", 1, "B", sep))
        assertEquals("Foo", Tokens.insertToken("", 0, "Foo", sep))
        assertEquals("A - B - Foo", Tokens.insertToken("A - B", 99, "Foo", sep))
        assertEquals("A", Tokens.insertToken("A", 0, "  ", sep))
        val same = Tokens.moveTokenTo("A - B - C", 0, "A - B - C", 3, sep, sameField = true)
        assertEquals("B - C - A", same.src)
        assertEquals("B - C - A", same.dst)
        val across = Tokens.moveTokenTo("A - B", 0, "X", 1, sep, sameField = false)
        assertEquals("B", across.src)
        assertEquals("X - A", across.dst)
        val noop = Tokens.moveTokenTo("A - B - C", 1, "A - B - C", 2, sep, sameField = true)
        assertEquals("A - B - C", noop.src)
    }

    @Test
    fun spacedSlashAndPipeSeparateAndUnspacedNeverDo() {
        val table = listOf(
            "A / B" to listOf("A", "B"), "A // B" to listOf("A", "B"), "A | B" to listOf("A", "B"),
            "A ／ B" to listOf("A", "B"), "A ｜ B" to listOf("A", "B"), "A ／／ B" to listOf("A", "B"),
            "AC/DC - Back In Black" to listOf("AC/DC", "Back In Black"), "A - B / C | D" to listOf("A", "B", "C", "D"),
            "A /// B" to listOf("A /// B"), "A / " to listOf("A"), "24/7 | X" to listOf("24/7", "X"),
            "Artist | Title" to listOf("Artist", "Title"),
        )
        for ((s, want) in table) assertEquals(s, want, parts(s))
    }

    @Test
    fun aStoredPipeStringIsKeptVerbatimUntilEdited() {
        val s = "Artist | Title"
        assertEquals(s, Tokens.stripEdges(s))
        assertEquals("Artist | Other", Tokens.replaceToken(s, 1, "Other"))
        assertEquals("Artist | Title - C", Tokens.appendToken(s, "C", sep))
    }

    /** Not in the Swift suite: the port walks code points, so a character outside the BMP is one unit, never split. */
    @Test
    fun astralCharactersStayWhole() {
        val s = "🎵 Artist - 🎶Title 🎵"
        assertEquals(listOf(Token("🎵 Artist", " - "), Token("🎶Title 🎵", "")), Tokens.tokenize(s))
        assertEquals(s, Tokens.compose(Tokens.tokenize(s)))
        assertEquals("🎶Title 🎵", Tokens.removeToken(s, 0))
    }
}
