import Foundation

/// Pure port of `web/js/tokens.js` (ADD-071, ADD-072). Same rules, same round trip: compose(tokenize(s)) == s.
struct Token: Equatable {
    var text: String
    var sep: String
}

enum Tokens {
    private static let stop: Set<String> = ["feat", "featuring", "vol", "vs", "ft", "pt", "mr", "mrs", "ms", "dr", "jr", "sr", "st", "inc", "ltd", "ver", "prod"]
    private static let dashes: Set<Unicode.Scalar> = ["-", "\u{2013}", "\u{2014}"]
    private static let bullets: Set<Unicode.Scalar> = ["\u{25CF}", "\u{2022}"]

    private typealias S = [Unicode.Scalar]

    private static func str(_ s: S, _ from: Int, _ to: Int) -> String {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: s[from..<to])
        return String(v)
    }

    private static func isWs(_ s: S, _ i: Int) -> Bool {
        guard i >= 0, i < s.count else { return false }
        return s[i].properties.isWhitespace || s[i] == "\u{FEFF}"
    }

    private static func isLetter(_ c: Unicode.Scalar) -> Bool {
        let t = String(c)
        return t.lowercased() != t.uppercased()
    }

    private static func isLower(_ c: Unicode.Scalar) -> Bool {
        let t = String(c)
        return t.lowercased() == t && t.uppercased() != t
    }

    private static func periodSplits(_ s: S, _ i: Int) -> Bool {
        guard isWs(s, i + 1) else { return false }
        var j = i + 1
        while j < s.count && isWs(s, j) { j += 1 }
        if j >= s.count || isLower(s[j]) { return false }
        var k = i
        while k > 0 && isLetter(s[k - 1]) { k -= 1 }
        return i - k >= 3 && !stop.contains(str(s, k, i).lowercased())
    }

    private static func coreLength(_ s: S, _ i: Int) -> Int {
        let c = s[i]
        let prevWs = i > 0 && isWs(s, i - 1)
        let nextWs = isWs(s, i + 1)
        let atEnd = i + 1 == s.count
        if c == "|" { return 1 }
        if c == "," || c == ";" { return prevWs || nextWs || atEnd ? 1 : 0 }
        if c == ":" { return i > 0 && !prevWs && (nextWs || atEnd) ? 1 : 0 }
        if c == "/" || dashes.contains(c) { return prevWs && nextWs ? 1 : 0 }
        if bullets.contains(c) {
            var j = i
            while j < s.count && bullets.contains(s[j]) { j += 1 }
            return prevWs && isWs(s, j) ? j - i : 0
        }
        if c == "." { return periodSplits(s, i) ? 1 : 0 }
        return 0
    }

    static func tokenize(_ text: String) -> [Token] {
        let s = Array(text.unicodeScalars)
        var out: [Token] = []
        var start = 0
        var i = 0
        while i < s.count {
            let len = coreLength(s, i)
            if len == 0 { i += 1; continue }
            var sepStart = i
            while sepStart > start && isWs(s, sepStart - 1) { sepStart -= 1 }
            var end = i + len
            while true {
                while end < s.count && isWs(s, end) { end += 1 }
                let more = end < s.count ? coreLength(s, end) : 0
                if more == 0 { break }
                end += more
            }
            out.append(Token(text: str(s, start, sepStart), sep: str(s, sepStart, end)))
            start = end
            i = end
        }
        out.append(Token(text: str(s, start, s.count), sep: ""))
        return out
    }

    static func compose(_ tokens: [Token]) -> String { tokens.map { $0.text + $0.sep }.joined() }

    private static func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    private static func trimEnd(_ s: String) -> String {
        var v = Substring(s)
        while let l = v.unicodeScalars.last, l.properties.isWhitespace { v = v.dropLast() }
        return String(v)
    }

    static func isBlank(_ t: Token) -> Bool { trim(t.text).isEmpty }

    static func removeToken(_ text: String, _ i: Int) -> String {
        var toks = tokenize(text)
        guard i >= 0, i < toks.count else { return text }
        if toks.count == 1 { return "" }
        if i == toks.count - 1 {
            toks.removeLast()
            toks[toks.count - 1].sep = ""
        } else {
            toks.remove(at: i)
        }
        return trim(compose(toks))
    }

    static func replaceToken(_ text: String, _ i: Int, _ newText: String) -> String {
        var toks = tokenize(text)
        guard i >= 0, i < toks.count else { return text }
        let t = trim(newText)
        if t.isEmpty { return removeToken(text, i) }
        toks[i].text = t
        return compose(toks)
    }

    static func endsWithSeparator(_ text: String) -> Bool {
        let toks = tokenize(text)
        return toks.count > 1 && isBlank(toks[toks.count - 1])
    }

    static func appendToken(_ text: String, _ token: String, _ defaultSep: String) -> String {
        let t = trim(token)
        if t.isEmpty { return text }
        if trim(text).isEmpty { return t }
        if endsWithSeparator(text) {
            let trimmed = trimEnd(text)
            return (trimmed == text ? text + " " : text) + t
        }
        return trimEnd(text) + defaultSep + t
    }

    static func moveToken(_ src: String, _ i: Int, _ dst: String, _ dstDefaultSep: String) -> (src: String, dst: String) {
        let toks = tokenize(src)
        guard i >= 0, i < toks.count, !isBlank(toks[i]) else { return (src, dst) }
        return (removeToken(src, i), appendToken(dst, toks[i].text, dstDefaultSep))
    }

    static func stripEdges(_ text: String) -> String {
        var toks = tokenize(text)
        while toks.count > 1 && isBlank(toks[toks.count - 1]) {
            toks.removeLast()
            toks[toks.count - 1].sep = ""
        }
        while toks.count > 1 && isBlank(toks[0]) { toks.removeFirst() }
        return trim(compose(toks))
    }

    static func commitTyped(_ text: String, _ typed: String, _ defaultSep: String) -> (value: String, rest: String) {
        var toks = tokenize(typed)
        if toks.count < 2 { return (text, typed) }
        let rest = toks.removeLast().text
        let done = compose(toks)
        let chunk = String(done.drop { $0.unicodeScalars.allSatisfy { $0.properties.isWhitespace } })
        let value: String
        if trim(chunk).isEmpty || toks.allSatisfy(isBlank) { value = text }
        else if trim(text).isEmpty { value = chunk }
        else if endsWithSeparator(text) { value = (trimEnd(text) == text ? text + " " : text) + chunk }
        else { value = trimEnd(text) + defaultSep + chunk }
        return (value, rest)
    }
}

#if DEBUG
/// Port of `web/js/tokens.test.mjs`. Not run at launch; call from a debugger or a scratch test to check the port.
func tokensSelfCheck() -> [String] {
    var failures: [String] = []
    func eq<T: Equatable>(_ a: T, _ b: T, _ n: String) { if a != b { failures.append("\(n): \(a) != \(b)") } }
    func texts(_ s: String) -> [String] { Tokens.tokenize(s).map(\.text) }
    func seps(_ s: String) -> [String] { Tokens.tokenize(s).map(\.sep) }

    let alex = "Gala - Freed From Desire | Progressive Rework"
    eq(texts(alex), ["Gala", "Freed From Desire", "Progressive Rework"], "alex texts")
    eq(seps(alex), [" - ", " | ", ""], "alex seps")
    let q = "Sadrican, DJ Harley Q., DJ Anna Fahrenheit, GOLDFISH"
    eq(texts(q), ["Sadrican", "DJ Harley Q.", "DJ Anna Fahrenheit", "GOLDFISH"], "comma list")
    eq(seps(q), [", ", ", ", ", ", ""], "comma seps")
    eq(texts("J. R. R. Tolkien"), ["J. R. R. Tolkien"], "initials")
    eq(texts("Hip-Hop - Mix"), ["Hip-Hop", "Mix"], "hip-hop")
    eq(texts("Jean-Michel Jarre"), ["Jean-Michel Jarre"], "jean-michel")
    eq(texts("A - B (Sadrican Remix)"), ["A", "B (Sadrican Remix)"], "brackets")
    eq(texts("Sadrican 2026 Remix"), ["Sadrican 2026 Remix"], "year")
    eq(texts("AC/DC"), ["AC/DC"], "acdc")
    eq(texts("A / B"), ["A", "B"], "slash")
    eq(texts("Hello World. Next Part"), ["Hello World", "Next Part"], "period")
    eq(texts("Song feat. Someone"), ["Song feat. Someone"], "feat")
    eq(texts("Best Of Vol. 2"), ["Best Of Vol. 2"], "vol")
    eq(texts("Mr. Brightside"), ["Mr. Brightside"], "mr")
    eq(texts("Version 1.5 Mix"), ["Version 1.5 Mix"], "decimal")
    eq(texts("Wait... Now"), ["Wait... Now"], "ellipsis")
    eq(texts("Mix. extended"), ["Mix. extended"], "lower after period")
    eq(texts("A: B; C \u{2022} D \u{25CF}\u{25CF} E \u{2013} F \u{2014} G"), ["A", "B", "C", "D", "E", "F", "G"], "other seps")
    eq(texts("12:30 Mix"), ["12:30 Mix"], "time")
    eq(texts("1,000 Ways"), ["1,000 Ways"], "thousands")
    eq(texts("A|B"), ["A", "B"], "pipe")
    eq(seps("A|B"), ["|", ""], "pipe seps")
    eq(Tokens.tokenize(""), [Token(text: "", sep: "")], "empty")
    eq(texts("| A"), ["", "A"], "leading sep")
    eq(texts("A |"), ["A", ""], "trailing sep")
    eq(texts("A | | B"), ["A", "B"], "folded")
    eq(seps("A | | B"), [" | | ", ""], "folded seps")
    eq(Tokens.endsWithSeparator("A, "), true, "ends sep")
    eq(Tokens.endsWithSeparator("A"), false, "no ends sep")

    let tricky = ["", " ", "   ", "A", " A ", "A - B", "A -", "- A", " - ", "|", "||", ", ,", "A,B", "A , B", "A,", ",A",
                  "A | | B", alex, q, "Hip-Hop - Mix", "A - B (Sadrican Remix)", "Hello World. Next", "Hello World.", "Hello World. ", "... ... ",
                  "a \u{25CF}\u{25CF} b", "\u{25CF}\u{25CF}", " \u{2022} ", "x:y", "x: y", "x :", "\u{2014}", "A \u{2014} B \u{2013} C - D",
                  "tab\tseparated\t-\tsample", "new\nline | x", "Mr. Brightside, Vol. 2 | feat. X", "\u{0416}\u{0443}\u{043A}. \u{0422}\u{0435}\u{0441}\u{0442} - \u{041C}\u{0438}\u{043A}\u{0441}"]
    for s in tricky { eq(Tokens.compose(Tokens.tokenize(s)), s, "round trip \(s)") }

    let s = "A - B | C"
    eq(Tokens.removeToken(s, 0), "B | C", "remove first")
    eq(Tokens.removeToken(s, 1), "A - C", "remove middle")
    eq(Tokens.removeToken(s, 2), "A - B", "remove last")
    eq(Tokens.removeToken("Solo", 0), "", "remove only")
    eq(Tokens.removeToken(s, 9), s, "remove out of range")
    eq(Tokens.replaceToken("A - B | C", 1, "Bee"), "A - Bee | C", "replace")
    eq(Tokens.replaceToken("A - B", 1, ""), "A", "replace empty")
    eq(texts(Tokens.replaceToken("A - B", 1, "X, Y")), ["A", "X", "Y"], "replace re-tokenizes")
    eq(Tokens.appendToken("", "Foo", ", "), "Foo", "append blank")
    eq(Tokens.appendToken("A", "Foo", ", "), "A, Foo", "append")
    eq(Tokens.appendToken("A  ", " Foo ", " - "), "A - Foo", "append trims")
    eq(Tokens.appendToken("A, ", "Foo", " - "), "A, Foo", "append after sep")
    eq(Tokens.appendToken("A,", "Foo", " - "), "A, Foo", "append after bare sep")
    eq(Tokens.appendToken("A", "  ", ", "), "A", "append blank token")
    let m1 = Tokens.moveToken("Gala - Remix Guy", 1, "Sadrican", ", ")
    eq(m1.src, "Gala", "move src"); eq(m1.dst, "Sadrican, Remix Guy", "move dst")
    let m2 = Tokens.moveToken("Only", 0, "", " ")
    eq(m2.src, "", "move only src"); eq(m2.dst, "Only", "move only dst")
    let m3 = Tokens.moveToken("A |", 1, "X", " ")
    eq(m3.src, "A |", "move blank src"); eq(m3.dst, "X", "move blank dst")
    eq(Tokens.stripEdges("Mix, "), "Mix", "strip trailing")
    eq(Tokens.stripEdges("| A |"), "A", "strip both")
    eq(Tokens.stripEdges("A - B"), "A - B", "strip none")
    let c1 = Tokens.commitTyped("", "Foo,", ", ")
    eq(c1.value, "Foo,", "commit 1 value"); eq(c1.rest, "", "commit 1 rest")
    let c2 = Tokens.commitTyped("A", "Foo, Ba", ", ")
    eq(c2.value, "A, Foo, ", "commit 2 value"); eq(c2.rest, "Ba", "commit 2 rest")
    let c3 = Tokens.commitTyped("A", "Foo", ", ")
    eq(c3.value, "A", "commit 3 value"); eq(c3.rest, "Foo", "commit 3 rest")
    let c4 = Tokens.commitTyped("A, ", " | x", ", ")
    eq(c4.value, "A, ", "commit 4 value"); eq(c4.rest, "x", "commit 4 rest")
    return failures
}
#endif
