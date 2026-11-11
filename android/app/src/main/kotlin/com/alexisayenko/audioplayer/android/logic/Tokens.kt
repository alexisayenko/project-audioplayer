package com.alexisayenko.audioplayer.android.logic

/**
 * One piece of a name field ("Artist - Title") with the separator that follows it, kept exactly as typed.
 * Ports `Token` of `ios/Sources/Tokens.swift`.
 */
data class Token(val text: String, val sep: String)

/** The two fields after a token moved from one to the other ([Tokens.moveToken], [Tokens.moveTokenTo]). */
data class TokenMove(val src: String, val dst: String)

/** What [Tokens.commitTyped] gives: the field's new value and the text still being typed. */
data class TypedCommit(val value: String, val rest: String)

/**
 * Splits a name field into pills and puts it back together: `compose(tokenize(s)) == s` for every string.
 * A separator is a dash, slash or pipe with white space on both sides; nothing else ever splits.
 *
 * Ports `Tokens` of `ios/Sources/Tokens.swift` (itself a port of `web/js/tokens.js`), checked against
 * `token_cases.json`. Swift walks Unicode scalars; this walks code points, so characters outside the BMP count once.
 * One difference: Swift trims whole grapheme clusters in `trimEnd` and `commitTyped`, this trims code points, which
 * only differs for a white-space character that carries a combining mark.
 */
object Tokens {
    private val dashes = setOf('-'.code, 0x2013, 0x2014)
    private val slashes = setOf('/'.code, 0xFF0F)
    private val pipes = setOf('|'.code, 0xFF5C)

    private fun str(s: IntArray, from: Int, to: Int): String = String(s, from, to - from)

    private fun isWs(s: IntArray, i: Int): Boolean = i >= 0 && i < s.size && (isUnicodeWhitespace(s[i]) || s[i] == 0xFEFF)

    private fun coreLength(s: IntArray, i: Int): Int {
        if (i <= 0 || !isWs(s, i - 1)) return 0
        val c = s[i]
        if (c in dashes || c in pipes) return if (isWs(s, i + 1)) 1 else 0
        if (c !in slashes) return 0
        val len = if (i + 1 < s.size && s[i + 1] in slashes) 2 else 1
        return if (isWs(s, i + len)) len else 0
    }

    /** Cuts [text] into tokens; the last token always has an empty separator. */
    fun tokenize(text: String): List<Token> {
        val s = text.codePoints().toArray()
        val out = mutableListOf<Token>()
        var start = 0
        var i = 0
        while (i < s.size) {
            val len = coreLength(s, i)
            if (len == 0) {
                i += 1
                continue
            }
            var sepStart = i
            while (sepStart > start && isWs(s, sepStart - 1)) sepStart -= 1
            var end = i + len
            while (true) {
                while (end < s.size && isWs(s, end)) end += 1
                val more = if (end < s.size) coreLength(s, end) else 0
                if (more == 0) break
                end += more
            }
            out.add(Token(str(s, start, sepStart), str(s, sepStart, end)))
            start = end
            i = end
        }
        out.add(Token(str(s, start, s.size), ""))
        return out
    }

    /** Joins tokens back into the field's text. */
    fun compose(tokens: List<Token>): String = tokens.joinToString("") { it.text + it.sep }

    /** True when the token holds nothing but white space. */
    fun isBlank(t: Token): Boolean = t.text.trimWhitespace().isEmpty()

    /** The visible pills of a field: token texts trimmed, blank ones left out. */
    fun parts(text: String): List<String> = tokenize(text).map { it.text.trimWhitespace() }.filter { it.isNotEmpty() }

    private fun MutableList<Token>.dropLastToken() {
        removeAt(size - 1)
        this[size - 1] = this[size - 1].copy(sep = "")
    }

    /** Removes token [i] together with one separator; an index out of range leaves [text] as it is. */
    fun removeToken(text: String, i: Int): String {
        val toks = tokenize(text).toMutableList()
        if (i < 0 || i >= toks.size) return text
        if (toks.size == 1) return ""
        if (i == toks.size - 1) {
            toks.dropLastToken()
        } else {
            toks.removeAt(i)
            if (toks.size > 1 && isBlank(toks[toks.size - 1])) toks.dropLastToken()
        }
        return compose(toks).trimWhitespace()
    }

    /** Replaces the text of token [i], keeping every separator; an empty [newText] removes the token. */
    fun replaceToken(text: String, i: Int, newText: String): String {
        val toks = tokenize(text).toMutableList()
        if (i < 0 || i >= toks.size) return text
        val t = newText.trimWhitespace()
        if (t.isEmpty()) return removeToken(text, i)
        toks[i] = toks[i].copy(text = t)
        return compose(toks)
    }

    /** True when [text] ends with a separator, so the next token needs none. */
    fun endsWithSeparator(text: String): Boolean {
        val toks = tokenize(text)
        return toks.size > 1 && isBlank(toks[toks.size - 1])
    }

    /** Adds [token] at the end of [text], joined with [defaultSep] unless the text already ends with a separator. */
    fun appendToken(text: String, token: String, defaultSep: String): String {
        val t = token.trimWhitespace()
        if (t.isEmpty()) return text
        if (text.trimWhitespace().isEmpty()) return t
        if (endsWithSeparator(text)) {
            val trimmed = text.trimWhitespaceEnd()
            return (if (trimmed == text) "$text " else text) + t
        }
        return text.trimWhitespaceEnd() + defaultSep + t
    }

    /** Moves token [i] of [src] to the end of [dst]; a blank or missing token changes nothing. */
    fun moveToken(src: String, i: Int, dst: String, dstDefaultSep: String): TokenMove {
        val toks = tokenize(src)
        if (i < 0 || i >= toks.size || isBlank(toks[i])) return TokenMove(src, dst)
        return TokenMove(removeToken(src, i), appendToken(dst, toks[i].text, dstDefaultSep))
    }

    /** Puts [token] before token [index] of [text] (Swift `insertToken(_:at:token:defaultSep:)`). */
    fun insertToken(text: String, index: Int, token: String, defaultSep: String): String {
        val t = token.trimWhitespace()
        if (t.isEmpty()) return text
        if (text.trimWhitespace().isEmpty()) return t
        val toks = tokenize(text).toMutableList()
        var at = maxOf(0, index)
        if (at == 0 && isBlank(toks[0])) at = 1
        if (at >= toks.size || (at == toks.size - 1 && isBlank(toks[at]))) return appendToken(text, t, defaultSep)
        toks.add(at, Token(t, defaultSep))
        return compose(toks)
    }

    /**
     * Moves token [index] of [src] to position [dstIndex] of [dst] (drag and drop of a pill).
     * [sameField] says both are one field (then both results are the same text); null means "when the texts are equal".
     */
    fun moveTokenTo(
        src: String,
        index: Int,
        dst: String,
        dstIndex: Int,
        dstDefaultSep: String,
        sameField: Boolean? = null,
    ): TokenMove {
        val same = sameField ?: (src == dst)
        val toks = tokenize(src)
        if (index < 0 || index >= toks.size || isBlank(toks[index])) return TokenMove(src, dst)
        val at = minOf(dstIndex, tokenize(dst).size)
        if (same) {
            if (at == index || at == index + 1) return TokenMove(src, src)
            val out = insertToken(removeToken(src, index), if (at > index) at - 1 else at, toks[index].text, dstDefaultSep)
            return TokenMove(out, out)
        }
        return TokenMove(removeToken(src, index), insertToken(dst, at, toks[index].text, dstDefaultSep))
    }

    /** Drops blank tokens and their separators from both ends; what is saved from a field. */
    fun stripEdges(text: String): String {
        val toks = tokenize(text).toMutableList()
        while (toks.size > 1 && isBlank(toks[toks.size - 1])) toks.dropLastToken()
        while (toks.size > 1 && isBlank(toks[0])) toks.removeAt(0)
        return compose(toks).trimWhitespace()
    }

    /**
     * Turns what is being typed into pills as soon as it holds a full separator: the finished part joins [text],
     * the unfinished part comes back as [TypedCommit.rest].
     */
    fun commitTyped(text: String, typed: String, defaultSep: String): TypedCommit {
        val toks = tokenize(typed).toMutableList()
        if (toks.size < 2) return TypedCommit(text, typed)
        val rest = toks.removeAt(toks.size - 1).text
        val chunk = compose(toks).trimWhitespaceStart()
        val value = when {
            chunk.trimWhitespace().isEmpty() || toks.all(::isBlank) -> text
            text.trimWhitespace().isEmpty() -> chunk
            endsWithSeparator(text) -> (if (text.trimWhitespaceEnd() == text) "$text " else text) + chunk
            else -> text.trimWhitespaceEnd() + defaultSep + chunk
        }
        return TypedCommit(value, rest)
    }
}
