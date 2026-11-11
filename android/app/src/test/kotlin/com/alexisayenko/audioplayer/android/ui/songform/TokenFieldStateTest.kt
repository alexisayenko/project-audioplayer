package com.alexisayenko.audioplayer.android.ui.songform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* The typing, editing and moving rules of the pill field (the state of the Swift `TokenField` view), without any drawing. */
class TokenFieldStateTest {
    private class Box(var text: String) {
        fun field(kind: TokenKind) = TokenFieldState(kind, text) { text = it }
        fun target(kind: TokenKind) = TokenTarget(kind, { text }, { text = it })
    }

    private fun labels(f: TokenFieldState) = f.shown.map { it.text }

    @Test fun aTypedSpacedSeparatorCommitsAPill() {
        val box = Box("")
        val f = box.field(TokenKind.Title)
        f.onPendingChange("Daft Punk")
        assertEquals(emptyList<String>(), labels(f))
        assertEquals("Daft Punk", box.text)
        f.onPendingChange("Daft Punk - ")
        assertEquals(listOf("Daft Punk"), labels(f))
        assertEquals("", f.pending)
        assertEquals("Daft Punk", box.text)
        f.onPendingChange("Voyager")
        assertEquals("Daft Punk - Voyager", box.text)
        f.commitPending()
        assertEquals(listOf("Daft Punk", "Voyager"), labels(f))
    }

    @Test fun pipeAndSlashCommitToo() {
        for (sep in listOf(" | ", " / ")) {
            val box = Box("")
            val f = box.field(TokenKind.Artist)
            f.onPendingChange("A${sep}B")
            assertEquals(listOf("A"), labels(f))
            assertEquals("B", f.pending)
            assertEquals("A${sep}B", box.text)
        }
    }

    @Test fun unspacedSeparatorsAndCommasNeverSplit() {
        val box = Box("")
        val f = box.field(TokenKind.Artist)
        f.onPendingChange("AC/DC, Jean-Michel Jarre")
        assertEquals("AC/DC, Jean-Michel Jarre", f.pending)
        f.commitPending()
        assertEquals(listOf("AC/DC, Jean-Michel Jarre"), labels(f))
    }

    @Test fun enterJoinsWithTheFieldsOwnSeparator() {
        val title = Box("A")
        title.field(TokenKind.Title).apply { onPendingChange("B"); commitPending() }
        assertEquals("A - B", title.text)
        val remix = Box("A")
        remix.field(TokenKind.Remixer).apply { onPendingChange("B"); commitPending() }
        assertEquals("A B", remix.text)
    }

    @Test fun leavingTheEntryCommitsAndDropsATrailingSeparator() {
        val box = Box("")
        val f = box.field(TokenKind.Title)
        f.onPendingChange("Mix - ")
        f.onEntryBlur()
        assertEquals("Mix", box.text)
        f.onPendingChange("Extended")
        f.onEntryBlur()
        assertEquals("Mix - Extended", box.text)
        assertEquals("", f.pending)
    }

    @Test fun editReplacesOnePillAndKeepsItsSeparators() {
        val box = Box("A – B")
        val f = box.field(TokenKind.Title)
        f.startEdit(1, "B")
        assertEquals(1, f.editing)
        f.editText = " X "
        f.finishEdit()
        assertNull(f.editing)
        assertEquals("A – X", box.text)
        f.startEdit(0, "A")
        f.editText = ""
        f.finishEdit()
        assertEquals("X", box.text)
    }

    @Test fun anUnchangedEditWritesNothing() {
        var writes = 0
        val f = TokenFieldState(TokenKind.Title, "A - B") { writes += 1 }
        f.startEdit(0, "A")
        f.finishEdit()
        assertEquals(0, writes)
    }

    @Test fun removeTakesThePillAndOneSeparator() {
        val box = Box("A - B - C")
        val f = box.field(TokenKind.Title)
        f.remove(1)
        assertEquals("A - C", box.text)
    }

    @Test fun moveToAnotherFieldAppendsThere() {
        val title = Box("Daft Punk - Voyager")
        val artist = Box("Someone")
        val f = title.field(TokenKind.Title)
        f.move(0, artist.target(TokenKind.Artist))
        assertEquals("Voyager", title.text)
        assertEquals("Someone, Daft Punk", artist.text)
    }

    @Test fun dropBetweenFieldsInsertsBeforeThePillOrAppends() {
        val title = Box("Daft Punk - Voyager")
        val artist = Box("A, B - C")
        val into = artist.field(TokenKind.Artist)
        assertTrue(into.drop(TokenDrag(TokenKind.Title, 0), 1, listOf(title.target(TokenKind.Title))))
        assertEquals("Voyager", title.text)
        assertEquals("A, B - Daft Punk, C", artist.text)
        assertTrue(into.drop(TokenDrag(TokenKind.Title, 0), Int.MAX_VALUE, listOf(title.target(TokenKind.Title))))
        assertEquals("", title.text)
        assertEquals("A, B - Daft Punk, C, Voyager", artist.text)
    }

    @Test fun dropInsideOneFieldReorders() {
        val box = Box("A - B - C")
        val f = box.field(TokenKind.Title)
        assertTrue(f.drop(TokenDrag(TokenKind.Title, 2), 0, emptyList()))
        assertEquals("C - A - B", box.text)
        assertFalse(f.drop(TokenDrag(TokenKind.Title, 0), 0, emptyList()))
        assertFalse(f.drop(TokenDrag(TokenKind.Artist, 0), 0, emptyList()))
    }

    @Test fun textSetFromOutsideReplacesThePillsAndTheTyping() {
        val box = Box("A")
        val f = box.field(TokenKind.Title)
        f.onPendingChange("typing")
        f.onExternalText(box.text)
        assertEquals("typing", f.pending)
        f.onExternalText("New - Value")
        assertEquals("", f.pending)
        assertEquals(listOf("New", "Value"), labels(f))
    }
}
