package com.alexisayenko.audioplayer.android.ui.songform

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.alexisayenko.audioplayer.android.logic.Tokens
import com.alexisayenko.audioplayer.android.logic.trimWhitespace

/** The three pill fields of the song form (Swift `TokenKind`). */
enum class TokenKind(
    /** The caption above the field and its TalkBack name. */
    val label: String,
    /** The short name in "Move to ...". */
    val moveName: String,
    /** The separator put between two pills when the person typed none. */
    val sep: String,
) {
    Title("Title", "Title", " - "),
    Artist("Artist", "Artist", ", "),
    Remixer("Remix & additional production", "Remix", " "),
}

/** Another pill field a pill can move to: its kind and how to read and write its text (Swift `TokenMove`). */
class TokenTarget(val kind: TokenKind, val text: () -> String, val setText: (String) -> Unit)

/** What a dragged pill carries: its field and its token index (Swift `TokenDrag`). */
data class TokenDrag(val kind: TokenKind, val index: Int)

/** One visible pill: its token index in the field's text and its trimmed label. */
data class TokenPill(val index: Int, val text: String)

/**
 * The working state of one pill field over ONE plain string: the committed pills, the text still being typed and
 * the pill being edited. It is the state and the functions of the Swift `TokenField` view, without any drawing, so
 * the rules run in plain JVM tests. [onTextChange] gets the field's new value after every change.
 */
class TokenFieldState(val kind: TokenKind, text: String, private val onTextChange: (String) -> Unit) {
    var committed by mutableStateOf(text)
        private set
    var pending by mutableStateOf("")
        private set
    private var tail = false
    private var lastWritten = text

    /** Token index of the pill that is a text field right now, or null. */
    var editing by mutableStateOf<Int?>(null)
        private set
    var editOriginal by mutableStateOf("")
        private set
    var editText by mutableStateOf("")

    /** The pills to draw: blank tokens are left out. */
    val shown: List<TokenPill>
        get() = Tokens.tokenize(committed).mapIndexedNotNull { i, t -> if (Tokens.isBlank(t)) null else TokenPill(i, t.text.trimWhitespace()) }

    private fun read(): String {
        val blank = pending.trimWhitespace().isEmpty()
        val t = if (blank) committed else Tokens.appendToken(committed, pending, kind.sep)
        return if (tail && blank) Tokens.stripEdges(t) else t
    }

    private fun push() {
        val v = read()
        lastWritten = v
        onTextChange(v)
    }

    /** The owner's string changed from outside (a preview loaded, a pill arrived from another field). */
    fun onExternalText(new: String) {
        if (new == lastWritten) return
        committed = new
        pending = ""
        tail = false
        editing = null
        lastWritten = new
    }

    /** The entry text changed: a full separator in it turns the finished part into pills at once. */
    fun onPendingChange(new: String) {
        val r = Tokens.commitTyped(committed, new, kind.sep)
        if (r.rest != new) {
            committed = r.value
            tail = true
            pending = r.rest
        } else {
            pending = new
        }
        push()
    }

    /** Enter in the entry: the typed text becomes a pill. */
    fun commitPending() {
        if (pending.trimWhitespace().isEmpty()) return
        committed = Tokens.appendToken(committed, pending, kind.sep)
        pending = ""
        tail = false
        push()
    }

    /** The entry lost focus: typed text becomes a pill and a trailing separator is dropped. */
    fun onEntryBlur() {
        commitPending()
        if (tail) {
            committed = Tokens.stripEdges(committed)
            tail = false
            push()
        }
    }

    /** Turns pill [i] into a text field holding [label]. */
    fun startEdit(i: Int, label: String) {
        commitPending()
        editOriginal = label
        editText = label
        editing = i
    }

    /** Enter or loss of focus in a pill's text field: the pill takes the new text; empty text removes it. */
    fun finishEdit() {
        val i = editing ?: return
        editing = null
        if (editText.trimWhitespace() != editOriginal) {
            committed = Tokens.replaceToken(committed, i, editText)
            tail = false
            push()
        }
    }

    fun remove(i: Int) {
        editing = null
        committed = Tokens.removeToken(committed, i)
        tail = false
        push()
    }

    /** "Move to ...": pill [i] goes to the end of [target]. */
    fun move(i: Int, target: TokenTarget) {
        val r = Tokens.moveToken(committed, i, target.text(), target.kind.sep)
        committed = r.src
        tail = false
        push()
        target.setText(r.dst)
    }

    /**
     * A dragged pill lands in this field before token [index] (`Int.MAX_VALUE` appends). [moves] are the other
     * fields, to take the pill out of the one it came from. False when nothing changed.
     */
    fun drop(d: TokenDrag, index: Int, moves: List<TokenTarget>): Boolean {
        editing = null
        if (d.kind == kind) {
            val r = Tokens.moveTokenTo(committed, d.index, committed, index, kind.sep, sameField = true)
            if (r.dst == committed) return false
            committed = r.dst
        } else {
            val from = moves.firstOrNull { it.kind == d.kind } ?: return false
            val source = from.text()
            val r = Tokens.moveTokenTo(source, d.index, committed, index, kind.sep, sameField = false)
            if (r.src == source && r.dst == committed) return false
            committed = r.dst
            from.setText(r.src)
        }
        tail = false
        push()
        return true
    }
}
