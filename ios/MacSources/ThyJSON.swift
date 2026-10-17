import Foundation

indirect enum ThyJSON: Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([ThyJSON])
    case object([(key: String, value: ThyJSON)])

    static func == (a: ThyJSON, b: ThyJSON) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case let (.bool(x), .bool(y)): return x == y
        case let (.number(x), .number(y)): return x == y
        case let (.string(x), .string(y)): return x == y
        case let (.array(x), .array(y)): return x == y
        case let (.object(x), .object(y)):
            return x.count == y.count && zip(x, y).allSatisfy { $0.key == $1.key && $0.value == $1.value }
        default: return false
        }
    }

    var string: String? { if case let .string(s) = self { s } else { nil } }
    var array: [ThyJSON]? { if case let .array(a) = self { a } else { nil } }
    var isObject: Bool { if case .object = self { true } else { false } }

    subscript(key: String) -> ThyJSON? {
        guard case let .object(pairs) = self else { return nil }
        return pairs.first { $0.key == key }?.value
    }

    static func parse(_ data: Data) throws -> ThyJSON {
        var p = ThyJSONParser(bytes: Array(data))
        p.skip()
        let v = try p.value()
        p.skip()
        guard p.i == p.bytes.count else { throw ThyJSONError.bad }
        return v
    }

    func stringified(indent: Int = 2) -> String {
        var out = ""
        write(&out, level: 0, indent: indent)
        return out
    }

    private func write(_ out: inout String, level: Int, indent: Int) {
        let pad = String(repeating: " ", count: (level + 1) * indent)
        let end = String(repeating: " ", count: level * indent)
        switch self {
        case .null: out += "null"
        case let .bool(b): out += b ? "true" : "false"
        case let .number(n): out += Self.numberText(n)
        case let .string(s): out += Self.quote(s)
        case let .array(a):
            if a.isEmpty { out += "[]"; return }
            out += "[\n"
            for (i, v) in a.enumerated() {
                out += pad
                v.write(&out, level: level + 1, indent: indent)
                out += i < a.count - 1 ? ",\n" : "\n"
            }
            out += end + "]"
        case let .object(o):
            if o.isEmpty { out += "{}"; return }
            out += "{\n"
            for (i, kv) in o.enumerated() {
                out += pad + Self.quote(kv.key) + ": "
                kv.value.write(&out, level: level + 1, indent: indent)
                out += i < o.count - 1 ? ",\n" : "\n"
            }
            out += end + "}"
        }
    }

    static func numberText(_ n: Double) -> String {
        if n.isNaN || n.isInfinite { return "null" }
        if n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
        return String(n)
    }

    private static func quote(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
            }
        }
        return out + "\""
    }
}

enum ThyJSONError: Error { case bad }

private struct ThyJSONParser {
    let bytes: [UInt8]
    var i = 0

    init(bytes: [UInt8]) { self.bytes = bytes }

    mutating func skip() {
        while i < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[i]) { i += 1 }
    }

    mutating func expect(_ s: String) throws {
        let b = Array(s.utf8)
        guard i + b.count <= bytes.count, Array(bytes[i..<i + b.count]) == b else { throw ThyJSONError.bad }
        i += b.count
    }

    mutating func value() throws -> ThyJSON {
        guard i < bytes.count else { throw ThyJSONError.bad }
        switch bytes[i] {
        case UInt8(ascii: "{"): return try object()
        case UInt8(ascii: "["): return try array()
        case UInt8(ascii: "\""): return .string(try string())
        case UInt8(ascii: "t"): try expect("true"); return .bool(true)
        case UInt8(ascii: "f"): try expect("false"); return .bool(false)
        case UInt8(ascii: "n"): try expect("null"); return .null
        default: return try number()
        }
    }

    mutating func number() throws -> ThyJSON {
        let start = i
        while i < bytes.count, "+-0123456789.eE".utf8.contains(bytes[i]) { i += 1 }
        guard i > start, let s = String(bytes: bytes[start..<i], encoding: .utf8), let n = Double(s) else { throw ThyJSONError.bad }
        return .number(n)
    }

    mutating func hex4() throws -> UInt32 {
        guard i + 4 <= bytes.count, let s = String(bytes: bytes[i..<i + 4], encoding: .utf8), let v = UInt32(s, radix: 16) else { throw ThyJSONError.bad }
        i += 4
        return v
    }

    mutating func string() throws -> String {
        i += 1
        var buf: [UInt8] = []
        while i < bytes.count {
            let c = bytes[i]
            i += 1
            if c == UInt8(ascii: "\"") { return String(decoding: buf, as: UTF8.self) }
            guard c == UInt8(ascii: "\\") else { buf.append(c); continue }
            guard i < bytes.count else { throw ThyJSONError.bad }
            let e = bytes[i]
            i += 1
            switch e {
            case UInt8(ascii: "n"): buf.append(0x0A)
            case UInt8(ascii: "t"): buf.append(0x09)
            case UInt8(ascii: "r"): buf.append(0x0D)
            case UInt8(ascii: "b"): buf.append(0x08)
            case UInt8(ascii: "f"): buf.append(0x0C)
            case UInt8(ascii: "u"):
                var code = try hex4()
                if (0xD800..<0xDC00).contains(code), i + 1 < bytes.count, bytes[i] == UInt8(ascii: "\\"), bytes[i + 1] == UInt8(ascii: "u") {
                    i += 2
                    let low = try hex4()
                    code = 0x10000 + ((code - 0xD800) << 10) + (low &- 0xDC00)
                }
                buf.append(contentsOf: Array(String(Unicode.Scalar(code) ?? "\u{FFFD}").utf8))
            default: buf.append(e)
            }
        }
        throw ThyJSONError.bad
    }

    mutating func array() throws -> ThyJSON {
        i += 1
        var out: [ThyJSON] = []
        skip()
        if i < bytes.count, bytes[i] == UInt8(ascii: "]") { i += 1; return .array(out) }
        while true {
            skip()
            out.append(try value())
            skip()
            guard i < bytes.count else { throw ThyJSONError.bad }
            if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
            if bytes[i] == UInt8(ascii: "]") { i += 1; return .array(out) }
            throw ThyJSONError.bad
        }
    }

    mutating func object() throws -> ThyJSON {
        i += 1
        var out: [(key: String, value: ThyJSON)] = []
        skip()
        if i < bytes.count, bytes[i] == UInt8(ascii: "}") { i += 1; return .object(out) }
        while true {
            skip()
            guard i < bytes.count, bytes[i] == UInt8(ascii: "\"") else { throw ThyJSONError.bad }
            let k = try string()
            skip()
            try expect(":")
            skip()
            let v = try value()
            if let at = out.firstIndex(where: { $0.key == k }) { out[at].value = v } else { out.append((k, v)) }
            skip()
            guard i < bytes.count else { throw ThyJSONError.bad }
            if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
            if bytes[i] == UInt8(ascii: "}") { i += 1; return .object(out) }
            throw ThyJSONError.bad
        }
    }
}
