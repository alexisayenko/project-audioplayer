import Foundation

/// Port of the pure logic in `web/js/theory.js`.
enum Thy {
    static let termsPath = "/data/theory-terms.json"
    static let anatomyPath = "/data/theory-anatomy.json"
    static let failText = "Could not load the terms. Reload to try again."
    static let emptyText = "No terms yet."
    static let anatomyFailText = "Could not load the examples. Reload to try again."
    static let anatomyTitle = "Composition metadata anatomy"
    static let anatomyIntro = "How one raw song title is split into the fields the library stores. Pick an example, then hover or focus a part of the title or a row of the legend to link them."

    struct Term: Identifiable, Equatable {
        let id: String
        let term: String
        let description: String
    }

    struct Field: Identifiable, Equatable {
        let id: String
        let path: String
        let label: String
        let tone: String?
        let description: String
    }

    struct Segment: Equatable {
        let text: String
        let fields: [String]
        let label: String?
    }

    struct Example: Identifiable, Equatable {
        let id: String
        let label: String
        let rawTitle: String
        let segments: [Segment]
        let song: ThyJSON
    }

    struct Anatomy: Equatable {
        let fields: [Field]
        let examples: [Example]
    }

    struct Row: Identifiable, Equatable {
        let field: Field
        let value: ThyJSON
        var id: String { field.id }
    }

    typealias Fetch = (String) async throws -> (Data, Int)

    static func sortTerms(_ list: [ThyJSON]) -> [Term] {
        list.compactMap { t -> Term? in
            guard let id = t["id"]?.string, let term = t["term"]?.string, let d = t["description"]?.string else { return nil }
            return Term(id: id, term: term, description: d)
        }
        .enumerated()
        .sorted { a, b in
            let r = a.element.term.compare(b.element.term, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: Locale(identifier: "en"))
            return r == .orderedSame ? a.offset < b.offset : r == .orderedAscending
        }
        .map(\.element)
    }

    static func loadTerms(_ fetch: Fetch) async throws -> [Term] {
        let (data, status) = try await fetch(termsPath)
        guard (200..<300).contains(status) else { throw ThyJSONError.bad }
        guard case let .array(list) = try ThyJSON.parse(data) else { throw ThyJSONError.bad }
        return sortTerms(list)
    }

    static func loadAnatomy(_ fetch: Fetch) async throws -> Anatomy {
        let (data, status) = try await fetch(anatomyPath)
        guard (200..<300).contains(status) else { throw ThyJSONError.bad }
        let root = try ThyJSON.parse(data)
        guard let fields = root["fields"]?.array, let examples = root["examples"]?.array else { throw ThyJSONError.bad }
        return Anatomy(
            fields: fields.compactMap { f in
                guard let id = f["id"]?.string, let path = f["path"]?.string else { return nil }
                return Field(id: id, path: path, label: f["label"]?.string ?? "", tone: f["tone"]?.string, description: f["description"]?.string ?? "")
            },
            examples: examples.compactMap { e in
                guard let id = e["id"]?.string, let raw = e["rawTitle"]?.string, let segs = e["segments"]?.array, let song = e["song"] else { return nil }
                return Example(id: id, label: e["label"]?.string ?? id, rawTitle: raw, segments: segs.compactMap { s in
                    guard let text = s["text"]?.string else { return nil }
                    return Segment(text: text, fields: s["fields"]?.array?.compactMap(\.string) ?? [], label: s["label"]?.string)
                }, song: song)
            })
    }

    static func pathValue(_ obj: ThyJSON, _ path: String) -> ThyJSON? {
        var cur: ThyJSON? = obj
        for key in path.split(separator: ".", omittingEmptySubsequences: false) {
            guard let c = cur else { return nil }
            cur = c[String(key)]
        }
        return cur
    }

    static func formatValue(_ v: ThyJSON) -> String {
        switch v {
        case let .array(a): return a.isEmpty ? "none" : a.map(formatValue).joined(separator: ", ")
        case let .object(o): return o.map { joinText($0.value) }.joined(separator: " ")
        case .null: return "none"
        case let .string(s): return s
        case let .number(n): return ThyJSON.numberText(n)
        case let .bool(b): return b ? "true" : "false"
        }
    }

    private static func joinText(_ v: ThyJSON) -> String {
        switch v {
        case .null: return ""
        case let .array(a): return a.map(joinText).joined(separator: ",")
        case .object: return "[object Object]"
        default: return formatValue(v)
        }
    }

    static func rows(for example: Example, fields: [Field]) -> [Row] {
        fields.compactMap { f in pathValue(example.song, f.path).map { Row(field: f, value: $0) } }
    }

    static func tone(of segment: Segment, in fields: [Field]) -> String {
        segment.fields.first.flatMap { id in fields.first { $0.id == id }?.tone } ?? "plain"
    }

    static func label(of segment: Segment, in fields: [Field]) -> String {
        segment.label ?? segment.fields.first.flatMap { id in fields.first { $0.id == id }?.label } ?? ""
    }
}

#if DEBUG
/// Port of the data and helper cases in `web/js/theory.test.mjs`. Not run at launch; call from a debugger or a scratch test.
func thyTheorySelfCheck() -> [String] {
    var fails: [String] = []
    func eq<T: Equatable>(_ a: T, _ b: T, _ n: String) { if a != b { fails.append("\(n): \(a) != \(b)") } }
    func json(_ s: String) -> ThyJSON { (try? ThyJSON.parse(Data(s.utf8))) ?? .null }

    eq(Thy.pathValue(json(#"{"a":{"b":3}}"#), "a.b"), .number(3), "pathValue nested")
    eq(Thy.pathValue(json("{}"), "a.b"), nil, "pathValue missing")
    eq(Thy.formatValue(json("[]")), "none", "format empty array")
    eq(Thy.formatValue(json(#"["A","B"]"#)), "A, B", "format array")
    eq(Thy.formatValue(json(#"{"platform":"youtube","url":"u"}"#)), "youtube u", "format object")
    eq(Thy.formatValue(json("null")), "none", "format null")
    eq(Thy.formatValue(json("2000")), "2000", "format number")

    let terms = json(#"[{"id":"s","term":"Syncopation","description":"d"},{"id":"b","term":"British Invasion","description":"d"},{"id":"d","term":"drum machine","description":"d"},{"id":"x","term":"No description"}]"#)
    eq(Thy.sortTerms(terms.array ?? []).map(\.id), ["b", "d", "s"], "sort and filter terms")

    let fields = [
        Thy.Field(id: "mainArtists", path: "mainArtists", label: "Main artist", tone: "main", description: ""),
        Thy.Field(id: "version.type", path: "version.type", label: "Version type", tone: "version", description: ""),
        Thy.Field(id: "version.originalArtists", path: "version.originalArtists", label: "Original artist", tone: "version", description: ""),
    ]
    let plain = Thy.Example(id: "plain", label: "", rawTitle: "x", segments: [], song: json(#"{"mainArtists":["Daft Punk"]}"#))
    eq(Thy.rows(for: plain, fields: fields).map(\.id), ["mainArtists"], "plain rows hide version fields")
    let cover = Thy.Example(id: "cover", label: "", rawTitle: "x", segments: [], song: json(#"{"mainArtists":["Teemid"],"version":{"type":"cover","originalArtists":["Gnarls Barkley"]}}"#))
    eq(Thy.rows(for: cover, fields: fields).map(\.id), ["mainArtists", "version.type", "version.originalArtists"], "cover rows")

    let seg = Thy.Segment(text: "Teemid", fields: ["mainArtists"], label: nil)
    eq(Thy.tone(of: seg, in: fields), "main", "segment tone")
    eq(Thy.label(of: seg, in: fields), "Main artist", "segment label")
    eq(Thy.tone(of: Thy.Segment(text: "?", fields: ["nope"], label: "L"), in: fields), "plain", "unknown tone")
    eq(Thy.label(of: Thy.Segment(text: "?", fields: ["nope"], label: "L"), in: fields), "L", "explicit label")

    eq(json(#"{"b":1,"a":[],"c":{},"d":[1,"x\n"]}"#).stringified(), "{\n  \"b\": 1,\n  \"a\": [],\n  \"c\": {},\n  \"d\": [\n    1,\n    \"x\\n\"\n  ]\n}", "stringify keeps key order")
    return fails
}
#endif
