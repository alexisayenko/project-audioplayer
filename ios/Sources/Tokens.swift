import Foundation

/// Pure port of `web/js/tokens.js` (ADD-071, ADD-072). Same rules, same round trip: compose(tokenize(s)) == s.
struct Token: Equatable {
    var text: String
    var sep: String
}

enum Tokens {
    private static let dashes: Set<Unicode.Scalar> = ["-", "\u{2013}", "\u{2014}"]
    private static let slashes: Set<Unicode.Scalar> = ["/", "\u{FF0F}"]
    private static let pipes: Set<Unicode.Scalar> = ["|", "\u{FF5C}"]

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

    private static func coreLength(_ s: S, _ i: Int) -> Int {
        guard i > 0, isWs(s, i - 1) else { return 0 }
        let c = s[i]
        if dashes.contains(c) || pipes.contains(c) { return isWs(s, i + 1) ? 1 : 0 }
        guard slashes.contains(c) else { return 0 }
        let len = i + 1 < s.count && slashes.contains(s[i + 1]) ? 2 : 1
        return isWs(s, i + len) ? len : 0
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
            if toks.count > 1, isBlank(toks[toks.count - 1]) {
                toks.removeLast()
                toks[toks.count - 1].sep = ""
            }
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

    static func insertToken(_ text: String, at index: Int, token: String, defaultSep: String) -> String {
        let t = trim(token)
        if t.isEmpty { return text }
        if trim(text).isEmpty { return t }
        var toks = tokenize(text)
        var at = max(0, index)
        if at == 0 && isBlank(toks[0]) { at = 1 }
        if at >= toks.count || (at == toks.count - 1 && isBlank(toks[at])) { return appendToken(text, t, defaultSep) }
        toks.insert(Token(text: t, sep: defaultSep), at: at)
        return compose(toks)
    }

    static func moveTokenTo(src: String, index i: Int, dst: String, dstIndex: Int, dstDefaultSep: String, sameField: Bool? = nil) -> (src: String, dst: String) {
        let same = sameField ?? (src == dst)
        let toks = tokenize(src)
        guard i >= 0, i < toks.count, !isBlank(toks[i]) else { return (src, dst) }
        let at = min(dstIndex, tokenize(dst).count)
        if same {
            if at == i || at == i + 1 { return (src, src) }
            let out = insertToken(removeToken(src, i), at: at > i ? at - 1 : at, token: toks[i].text, defaultSep: dstDefaultSep)
            return (out, out)
        }
        return (removeToken(src, i), insertToken(dst, at: at, token: toks[i].text, defaultSep: dstDefaultSep))
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
