import XCTest

private final class BundleAnchor {}

private struct RadiusCase: Decodable { let count: Int; let r: Double }
private struct SongCase: Decodable { let id: String; let tags: [String] }
private struct IDsCase: Decodable { let id: String; let ids: [String] }
private struct TagsCase: Decodable { let id: String; let tags: [String] }
private struct CategoryCase: Decodable { let id: String; let category: Bool }
private struct CountPair: Decodable, Equatable { let count: Int; let ownCount: Int }
private struct SearchCase: Decodable { let query: String; let limit: Int; let ids: [String] }
private struct KeysCase: Decodable { let id: String; let keys: [String] }
private struct DepthCase: Decodable { let id: String; let depth: [String: Int] }

private struct RowCase: Decodable, Equatable {
    let key: String
    let id: String?
    let depth: Int
    let label: String
    let count: Int?
    let hasChildren: Bool
    let expanded: Bool
    let alsoUnder: [String]
    let kind: String
    let size: Int
    let unit: String
}

private struct OutlineCase: Decodable { let expanded: [String]; let rows: [RowCase] }

private struct Expected: Decodable {
    let descendants: [IDsCase]
    let filterTags: [TagsCase]
    let localCounts: [String: CountPair]
    let search: [SearchCase]
    let categories: [CategoryCase]
    let outline: [OutlineCase]
    let pathKeys: [KeysCase]
    let ancestors: [DepthCase]
}

private struct GraphCases: Decodable {
    let radius: [RadiusCase]
    let songs: [SongCase]
    let graphs: [String: GenWire]
    let expected: [String: Expected]
}

private func kindName(_ kind: GenRowKind) -> String {
    switch kind {
    case .family: return "family"
    case .style: return "style"
    case .node: return "node"
    }
}

final class GenGraphCasesTests: XCTestCase {
    private func cases() throws -> GraphCases {
        let url = try XCTUnwrap(Bundle(for: BundleAnchor.self).url(forResource: "gen_graph_cases", withExtension: "json"))
        return try JSONDecoder().decode(GraphCases.self, from: Data(contentsOf: url))
    }

    private func forEachGraph(_ body: (String, GenGraph, Expected, [Track]) -> Void) throws {
        let all = try cases()
        let songs = all.songs.map { Track(id: $0.id, title: $0.id, artist: "", tags: $0.tags) }
        for (name, wire) in all.graphs { body(name, GenGraph(wire: wire), try XCTUnwrap(all.expected[name]), songs) }
    }

    func testNodeRadiusMatchesTheSharedCases() throws {
        for c in try cases().radius { XCTAssertEqual(genNodeRadius(c.count), c.r, accuracy: 1e-9, String(c.count)) }
    }

    func testDescendantsFilterTagsAndCategoriesMatchTheSharedCases() throws {
        try forEachGraph { name, g, want, _ in
            for c in want.descendants { XCTAssertEqual(g.descendants(of: c.id).sorted(), c.ids, "\(name) \(c.id)") }
            for c in want.filterTags { XCTAssertEqual(g.filterTags(c.id).sorted(), c.tags, "\(name) \(c.id)") }
            for c in want.categories { XCTAssertEqual(g[c.id].map(genIsCategory), c.category, "\(name) \(c.id)") }
        }
    }

    func testLocalCountsMatchTheSharedCases() throws {
        try forEachGraph { name, g, want, songs in
            let got = g.localCounts(songs)
            for (id, pair) in want.localCounts {
                XCTAssertEqual(got[id].map { CountPair(count: $0.count, ownCount: $0.own) }, pair, "\(name) \(id)")
            }
        }
    }

    func testSearchMatchesTheSharedCases() throws {
        try forEachGraph { name, g, want, _ in
            for c in want.search { XCTAssertEqual(g.search(c.query, limit: c.limit).map(\.id), c.ids, "\(name) \(c.query)") }
        }
    }

    func testOutlineRowsMatchTheSharedCases() throws {
        try forEachGraph { name, g, want, _ in
            for o in want.outline {
                let got = g.outlineRows(expanded: Set(o.expanded)).map { r in
                    RowCase(key: r.key, id: r.id_, depth: r.depth, label: r.label, count: r.count, hasChildren: r.hasChildren,
                            expanded: r.expanded, alsoUnder: r.alsoUnder, kind: kindName(r.kind), size: r.size, unit: r.unit)
                }
                XCTAssertEqual(got, o.rows, "\(name) expanded \(o.expanded.count)")
            }
        }
    }

    func testPathKeysAndAncestorsMatchTheSharedCases() throws {
        try forEachGraph { name, g, want, _ in
            for c in want.pathKeys { XCTAssertEqual(g.pathKeys(c.id), c.keys, "\(name) \(c.id)") }
            for c in want.ancestors { XCTAssertEqual(g.ancestors(of: c.id), c.depth, "\(name) \(c.id)") }
        }
    }
}
