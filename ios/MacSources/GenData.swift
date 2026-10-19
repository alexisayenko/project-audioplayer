import Foundation
import SwiftUI

/// Port of `web/js/genre-data.js`: the genre graph, its counts, search and the outline tree.
enum GenFamily {
    static let all = [
        "Electronic", "Rock", "Pop", "Hip Hop", "Jazz", "Funk / Soul", "Classical", "Reggae", "Latin",
        "Blues", "Folk, World, & Country", "Other",
    ]
    static let order = [
        "Blues", "Classical", "Electronic", "Folk, World, & Country", "Funk / Soul", "Hip Hop", "Jazz",
        "Latin", "Pop", "Reggae", "Rock", "Other",
    ]
    private static let colors: [Color] = [
        DS.Chart.chart0, DS.Chart.chart1, DS.Chart.chart2, DS.Chart.chart3, DS.Chart.chart4, DS.Chart.chart5, DS.Chart.chart6, DS.Chart.chart7,
        DS.Chart.chart8, DS.Chart.chart9, DS.Chart.chart10, DS.Chart.chart11, DS.Chart.chart12, DS.Chart.chart13, DS.Chart.chart14, DS.Chart.chart15,
    ]

    static let otherColor = 15

    static func index(_ family: String) -> Int {
        family == "Other" ? otherColor : (all.firstIndex(of: family) ?? otherColor)
    }
    static func orderIndex(_ family: String) -> Int { order.firstIndex(of: family) ?? order.count - 1 }
    static func color(_ index: Int) -> Color { colors[min(max(index, 0), colors.count - 1)] }
    static func color(of family: String) -> Color { color(index(family)) }
}

struct GenNode: Identifiable, Hashable {
    let id: String
    var label: String
    var qid: String?
    var wikipedia: String?
    var family: String
    var style: String?
    var count: Int
    var ownCount: Int
    var parents: [String]
    var tags: [String]
}

struct GenEdge: Hashable {
    let source: String
    let target: String
    let related: Bool
}

struct GenWire: Decodable {
    struct WNode: Decodable {
        var id: String
        var label: String
        var qid: String?
        var wikipedia: String?
        var family: String?
        var style: String?
        var count: Int?
        var ownCount: Int?
        var parents: [String]?
        var tags: [String]?
    }
    struct WEdge: Decodable {
        var source: String
        var target: String
        var kind: String?
    }
    var nodes: [WNode]?
    var edges: [WEdge]?
    var ontology: Bool?
    var pending: Bool?
}

func genNodeRadius(_ count: Int) -> Double { min(30, 4 + 2.4 * Double(max(0, count)).squareRoot()) }

func genNormalize(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

/// The `genre:` values of a track, normalised and de-duplicated, in tag order.
func genTrackGenres(_ t: Track?) -> [(key: String, label: String)] {
    var seen = Set<String>()
    var out: [(key: String, label: String)] = []
    for tag in t?.tags ?? [] {
        guard let i = tag.firstIndex(of: ":"), tag[..<i].trimmingCharacters(in: .whitespaces).lowercased() == "genre" else { continue }
        let key = genNormalize(String(tag[tag.index(after: i)...]))
        if key.isEmpty || !seen.insert(key).inserted { continue }
        out.append((key: key, label: tagLabel("genre:\(key)")))
    }
    return out
}

func genByCountThenLabel(_ a: GenNode, _ b: GenNode) -> Bool {
    if a.count != b.count { return a.count > b.count }
    return a.label.localizedCompare(b.label) == .orderedAscending
}

private let genCategoryPatterns: [NSRegularExpression] = [
    "^ethnic music$", "^music of .+", "^.+ diaspora$", "^world music$", "^folk music of .+",
    "^by (country|region|genre|decade)$", "^music genre$", "^music by .+",
    "^acoustic music$", "^vocal music$", "^instrumental music$", "^regional music$", "^national music$", "^traditional music$", "^folk music by .+", "^music genres? by .+",
].compactMap { try? NSRegularExpression(pattern: $0) }

func genIsCategory(_ n: GenNode) -> Bool {
    guard n.ownCount == 0 else { return false }
    let s = n.label.trimmingCharacters(in: .whitespaces).lowercased()
    let range = NSRange(s.startIndex..., in: s)
    return genCategoryPatterns.contains { $0.firstMatch(in: s, range: range) != nil }
}

enum GenRowKind { case family, style, node }

struct GenOutlineRow: Identifiable {
    var key: String
    var id_: String?
    var depth: Int
    var label: String
    var count: Int?
    var family: String
    var hasChildren: Bool
    var expanded: Bool
    var alsoUnder: [String]
    var kind: GenRowKind
    var size = 0
    var unit = "root"
    var id: String { key }
}

/// Indexed graph. Counts change in place (`applyCounts`), which drops the cached outline views.
final class GenGraph {
    private(set) var nodes: [GenNode]
    private(set) var index: [String: Int] = [:]
    private(set) var children: [String: [String]] = [:]
    let edges: [GenEdge]
    let ontology: Bool
    private var plain: GenBuiltView?
    private var hybrid: GenHybridView?

    init(wire: GenWire?) {
        var seenIDs = Set<String>()
        let raw = (wire?.nodes ?? []).filter { seenIDs.insert($0.id).inserted }
        var ns = raw.map { n in
            GenNode(id: n.id, label: n.label, qid: n.qid, wikipedia: n.wikipedia, family: n.family ?? "Other", style: n.style,
                    count: n.count ?? 0, ownCount: n.ownCount ?? n.count ?? 0, parents: [], tags: n.tags ?? [])
        }
        var idx: [String: Int] = [:]
        var ch: [String: [String]] = [:]
        for (i, n) in ns.enumerated() { idx[n.id] = i; ch[n.id] = [] }
        for (i, n) in raw.enumerated() {
            for p in n.parents ?? [] where idx[p] != nil && p != n.id && !ns[i].parents.contains(p) {
                ns[i].parents.append(p)
                ch[p, default: []].append(n.id)
            }
        }
        nodes = ns
        index = idx
        children = ch
        edges = (wire?.edges ?? []).filter { idx[$0.source] != nil && idx[$0.target] != nil && $0.source != $0.target }
            .map { GenEdge(source: $0.source, target: $0.target, related: $0.kind == "related") }
        ontology = wire?.ontology ?? false
    }

    init(nodes: [GenNode]) {
        self.nodes = nodes
        var idx: [String: Int] = [:]
        for (i, n) in nodes.enumerated() { idx[n.id] = i }
        index = idx
        children = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, [String]()) })
        edges = []
        ontology = false
    }

    subscript(id: String) -> GenNode? { index[id].map { nodes[$0] } }
    var hasStyles: Bool { nodes.contains { $0.style != nil } }

    func applyCounts(_ counts: [String: (count: Int, own: Int)]) {
        for i in nodes.indices {
            if let c = counts[nodes[i].id] { nodes[i].count = c.count; nodes[i].ownCount = c.own }
        }
        plain = nil
        hybrid = nil
    }

    func descendants(of id: String) -> Set<String> {
        var out = Set<String>()
        var stack = [id]
        while let x = stack.popLast() {
            if out.contains(x) || index[x] == nil { continue }
            out.insert(x)
            stack.append(contentsOf: children[x] ?? [])
        }
        return out
    }

    /// Lowercased `genre:` tags of the genre and every descendant, for the Library filter.
    func filterTags(_ id: String) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        for d in descendants(of: id).sorted() {
            for k in self[d]?.tags ?? [] where seen.insert(k).inserted { out.append("genre:\(k)") }
        }
        return out
    }

    func tagOwners() -> [String: String] {
        var owner: [String: String] = [:]
        for n in nodes { for k in n.tags.isEmpty ? [n.label.lowercased()] : n.tags { owner[genNormalize(k)] = n.id } }
        return owner
    }

    func localCounts(_ songs: [Track]) -> [String: (count: Int, own: Int)] {
        var own: [String: Set<String>] = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, Set<String>()) })
        var owner: [String: String] = [:]
        for n in nodes { for k in n.tags.isEmpty ? [n.label.lowercased()] : n.tags { owner[k.lowercased()] = n.id } }
        for s in songs {
            for t in s.tags ?? [] {
                guard let i = t.firstIndex(of: ":"), t[..<i].trimmingCharacters(in: .whitespaces).lowercased() == "genre" else { continue }
                if let id = owner[genNormalize(String(t[t.index(after: i)...]))] { own[id]?.insert(s.id) }
            }
        }
        var reach: [String: Set<String>] = [:]
        func visit(_ id: String, _ path: Set<String>) -> Set<String> {
            if let r = reach[id] { return r }
            var set = own[id] ?? []
            reach[id] = set
            for c in children[id] ?? [] where !path.contains(c) { set.formUnion(visit(c, path.union([id]))) }
            reach[id] = set
            return set
        }
        var out: [String: (Int, Int)] = [:]
        for n in nodes { out[n.id] = (visit(n.id, []).count, own[n.id]?.count ?? 0) }
        return out
    }

    func search(_ query: String, limit: Int = 8) -> [GenNode] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        var scored: [(GenNode, Int)] = []
        for n in nodes {
            let l = n.label.lowercased()
            guard let r = l.range(of: q) else { continue }
            let rank: Int
            if l == q { rank = 0 }
            else if r.lowerBound == l.startIndex { rank = 1 }
            else if l.split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "_" }).contains(where: { $0 == q }) { rank = 2 }
            else { rank = 3 }
            scored.append((n, rank))
        }
        scored.sort { a, b in
            if a.1 != b.1 { return a.1 < b.1 }
            if a.0.count != b.0.count { return a.0.count > b.0.count }
            return a.0.label.localizedCompare(b.0.label) == .orderedAscending
        }
        return scored.prefix(limit).map(\.0)
    }

    func ancestors(of id: String, maxDepth: Int = 12) -> [String: Int] {
        var up: [String: [String]] = [:]
        for e in edges where !e.related && e.source != e.target { up[e.source, default: []].append(e.target) }
        var depth: [String: Int] = [:]
        var level = [id]
        var d = 1
        while d <= maxDepth, !level.isEmpty {
            var next: [String] = []
            for n in level {
                for p in up[n] ?? [] where p != id && depth[p] == nil {
                    depth[p] = d
                    next.append(p)
                }
            }
            level = next
            d += 1
        }
        return depth
    }

    func orphans() -> [GenNode] {
        var linked = Set<String>()
        for e in edges where e.source != e.target { linked.insert(e.source); linked.insert(e.target) }
        return nodes.filter { !linked.contains($0.id) }.sorted {
            if $0.count != $1.count { return $0.count > $1.count }
            return $0.label.localizedCompare($1.label) == .orderedAscending
        }
    }

    func map(_ genres: [(key: String, label: String)]) -> [GenSongGenre] {
        let owner = tagOwners()
        return genres.map { GenSongGenre(key: $0.key, label: $0.label, nodeID: owner[$0.key]) }
    }

    // MARK: outline

    fileprivate func plainView() -> GenBuiltView {
        if let plain { return plain }
        let v = GenBuiltView(self) { _ in true }
        plain = v
        return v
    }

    fileprivate func hybridView() -> GenHybridView {
        if let hybrid { return hybrid }
        let v = GenHybridView(self)
        hybrid = v
        return v
    }

    func outlineRows(expanded: Set<String>) -> [GenOutlineRow] {
        hasStyles ? hybridRows(expanded) : plainRows(expanded)
    }

    private func familyGroups(_ roots: [String]) -> [(String, [String])] {
        var groups: [String: [String]] = [:]
        for id in roots { if let n = self[id] { groups[n.family, default: []].append(id) } }
        return groups.sorted { GenFamily.orderIndex($0.key) < GenFamily.orderIndex($1.key) }.map { ($0.key, $0.value) }
    }

    private func plainRows(_ expanded: Set<String>) -> [GenOutlineRow] {
        let v = plainView()
        var rows: [GenOutlineRow] = []
        func walk(_ id: String, _ depth: Int, _ key: String, _ via: String?, _ path: Set<String>) {
            guard let n = self[id] else { return }
            let kids = (v.children[id] ?? []).filter { !path.contains($0) }
            let open = expanded.contains(key) && !kids.isEmpty
            rows.append(GenOutlineRow(
                key: key, id_: id, depth: depth, label: n.label, count: n.count, family: n.family, hasChildren: !kids.isEmpty, expanded: open,
                alsoUnder: (v.parents[id] ?? []).filter { $0 != via }.compactMap { self[$0]?.label }, kind: .node))
            guard open else { return }
            for c in kids.compactMap({ self[$0] }).sorted(by: genByCountThenLabel) { walk(c.id, depth + 1, "\(key)>\(c.id)", id, path.union([id])) }
        }
        for (family, ids) in familyGroups(v.roots) {
            let key = "f:\(family)"
            let open = expanded.contains(key)
            rows.append(GenOutlineRow(key: key, id_: nil, depth: 0, label: family, count: nil, family: family, hasChildren: true, expanded: open,
                                      alsoUnder: [], kind: .family, size: ids.count, unit: "root"))
            if open { for id in ids { walk(id, 1, "\(key)>\(id)", nil, []) } }
        }
        return rows
    }

    private func hybridRows(_ expanded: Set<String>) -> [GenOutlineRow] {
        let v = hybridView()
        var rows: [GenOutlineRow] = []
        func walk(_ id: String, _ depth: Int, _ key: String, _ via: String?, _ path: Set<String>) {
            guard let n = self[id] else { return }
            let kids = v.children(id).filter { !path.contains($0) }
            let open = expanded.contains(key) && !kids.isEmpty
            rows.append(GenOutlineRow(
                key: key, id_: id, depth: depth, label: n.label, count: n.count, family: n.family, hasChildren: !kids.isEmpty, expanded: open,
                alsoUnder: v.parentsOf(id).filter { $0 != via }.compactMap { self[$0]?.label }, kind: v.styles.contains(id) ? .style : .node))
            guard open else { return }
            for c in kids.compactMap({ self[$0] }).sorted(by: genByCountThenLabel) { walk(c.id, depth + 1, "\(key)>\(c.id)", id, path.union([id])) }
        }
        for (family, ids) in familyGroups(v.roots) {
            let key = "f:\(family)"
            let open = expanded.contains(key)
            let styled = ids.filter { v.styles.contains($0) }.count
            rows.append(GenOutlineRow(key: key, id_: nil, depth: 0, label: family, count: nil, family: family, hasChildren: true, expanded: open,
                                      alsoUnder: [], kind: .family, size: ids.count, unit: styled == ids.count ? "genre" : "root"))
            if open { for id in ids { walk(id, 1, "\(key)>\(id)", nil, []) } }
        }
        return rows
    }

    /// Outline keys to expand so the genre's row is visible.
    func pathKeys(_ id: String) -> [String] {
        guard self[id] != nil else { return [] }
        func keys(_ chain: [String]) -> [String] {
            guard let first = chain.first, let n = self[first] else { return [] }
            var out = ["f:\(n.family)"]
            for c in chain { out.append("\(out.last!)>\(c)") }
            return out
        }
        var cur = id
        if hasStyles {
            let v = hybridView()
            if !v.row(cur) {
                guard let p = v.parentsOf(cur).compactMap({ self[$0] }).sorted(by: genByCountThenLabel).first else { return [] }
                cur = p.id
            }
            var chain = [cur]
            var seen: Set<String> = [cur]
            while let next = v.parentsOf(chain[0]).compactMap({ self[$0] }).sorted(by: genByCountThenLabel).first(where: { !seen.contains($0.id) }) {
                chain.insert(next.id, at: 0)
                seen.insert(next.id)
            }
            return keys(chain)
        }
        let v = plainView()
        if v.skip.contains(cur) {
            guard let p = v.eff(cur).compactMap({ self[$0] }).sorted(by: genByCountThenLabel).first else { return [] }
            cur = p.id
        }
        var chain = [cur]
        var seen: Set<String> = [cur]
        var node = cur
        while let ps = v.parents[node], !ps.isEmpty,
              let next = ps.compactMap({ self[$0] }).sorted(by: genByCountThenLabel).first(where: { !seen.contains($0.id) }) {
            chain.insert(next.id, at: 0)
            seen.insert(next.id)
            node = next.id
        }
        return keys(chain)
    }
}

struct GenSongGenre: Identifiable, Hashable {
    var key: String
    var label: String
    var nodeID: String?
    var id: String { key }
}

fileprivate final class GenBuiltView {
    let g: GenGraph
    var skip = Set<String>()
    var parents: [String: [String]] = [:]
    var children: [String: [String]] = [:]
    var roots: [String] = []
    private var up: [String: [String]] = [:]

    init(_ g: GenGraph, include: (GenNode) -> Bool) {
        self.g = g
        skip = Set(g.nodes.filter { !include($0) || genIsCategory($0) }.map(\.id))
        for n in g.nodes where !skip.contains(n.id) {
            let ps = eff(n.id)
            parents[n.id] = ps
            children[n.id] = children[n.id] ?? []
            for p in ps { children[p, default: []].append(n.id) }
            if ps.isEmpty { roots.append(n.id) }
        }
        roots = roots.compactMap { g[$0] }.sorted(by: genByCountThenLabel).map(\.id)
    }

    func eff(_ id: String) -> [String] {
        if let m = up[id] { return m }
        up[id] = []
        var out: [String] = []
        for p in g[id]?.parents ?? [] {
            for q in skip.contains(p) ? eff(p) : [p] where !out.contains(q) && q != id { out.append(q) }
        }
        up[id] = out
        return out
    }
}

fileprivate final class GenHybridView {
    let g: GenGraph
    var styles = Set<String>()
    var roots: [String] = []
    private var shownHung = Set<String>()
    private var placed: [String: [String]] = [:]
    private var orphans = Set<String>()
    private var kids: [String: [String]] = [:]
    private var fb: GenBuiltView!
    private var upMemo: [String: [String]] = [:]
    private var ssetMemo: [String: Set<String>] = [:]
    private var seen: [String: Bool] = [:]

    private static func fold(_ s: String) -> String {
        var t = s.lowercased().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        if t.hasSuffix(" music") { t.removeLast(6) }
        return t
    }

    private func isOwnStyle(_ n: GenNode) -> Bool {
        guard let style = n.style else { return false }
        let s = Self.fold(style)
        if Self.fold(n.label) == s || n.tags.contains(where: { Self.fold($0) == s }) { return true }
        return !n.parents.contains { g[$0]?.style == style }
    }

    private func up(_ id: String) -> [String] {
        if let m = upMemo[id] { return m }
        upMemo[id] = []
        var out: [String] = []
        for p in g[id]?.parents ?? [] {
            for q in styles.contains(p) || shownHung.contains(p) ? [p] : up(p) where q != id && !out.contains(q) { out.append(q) }
        }
        upMemo[id] = out
        return out
    }

    private func styleSet(_ id: String, _ path: Set<String> = []) -> Set<String> {
        if styles.contains(id) { return [id] }
        if let m = ssetMemo[id] { return m }
        if path.contains(id) { return [] }
        var out = Set<String>()
        for p in up(id) { out.formUnion(styleSet(p, path.union([id]))) }
        ssetMemo[id] = out
        return out
    }

    private func fbVisible(_ id: String, _ path: Set<String> = []) -> Bool {
        if let s = seen[id] { return s }
        var ok = (g[id]?.ownCount ?? 0) > 0
        for c in fb.children[id] ?? [] where !ok && !path.contains(c) { ok = fbVisible(c, path.union([id])) }
        seen[id] = ok
        return ok
    }

    init(_ g: GenGraph) {
        self.g = g
        styles = Set(g.nodes.filter { isOwnStyle($0) }.map(\.id))
        shownHung = Set(g.nodes.filter { $0.style != nil && !styles.contains($0.id) && $0.ownCount > 0 }.map(\.id))
        for n in g.nodes where shownHung.contains(n.id) {
            let ups = up(n.id)
            if ups.isEmpty { orphans.insert(n.id); continue }
            let hung = ups.filter { !styles.contains($0) }
            let keep = ups.filter { x in !styles.contains(x) || !hung.contains { styleSet($0).contains(x) } }
            placed[n.id] = keep.isEmpty ? ups : keep
        }
        fb = GenBuiltView(g) { [orphans] n in n.style == nil || orphans.contains(n.id) }
        for n in g.nodes { if let ps = placed[n.id] { for p in ps { kids[p, default: []].append(n.id) } } }
        let top = styles.filter { (g[$0]?.count ?? 0) > 0 } + fb.roots.filter { fbVisible($0) }
        roots = top.compactMap { g[$0] }.sorted(by: genByCountThenLabel).map(\.id)
    }

    func row(_ id: String) -> Bool {
        styles.contains(id) || placed[id] != nil || (fb.parents[id] != nil && fbVisible(id))
    }

    func parentsOf(_ id: String) -> [String] {
        if styles.contains(id) { return [] }
        if let p = placed[id] { return p }
        if let ps = fb.parents[id], fbVisible(id) { return ps.filter { row($0) } }
        let n = g[id]
        return (n?.style != nil && !orphans.contains(id) ? up(id) : fb.eff(id)).filter { row($0) }
    }

    func children(_ id: String) -> [String] {
        let fbKids = (fb.children[id] ?? []).filter { fbVisible($0) }
        var out: [String] = []
        for c in (kids[id] ?? []) + fbKids where !out.contains(c) { out.append(c) }
        return out
    }
}

/// Genres the user tagged, as a flat graph, when the server has no ontology to offer.
func genFlatGraph(_ songs: [Track]) -> GenGraph {
    var counts: [String: (label: String, n: Int)] = [:]
    var order: [String] = []
    for s in songs {
        for g in genTrackGenres(s) {
            if counts[g.key] == nil {
                counts[g.key] = (g.label, 0)
                order.append(g.key)
            }
            counts[g.key]!.n += 1
        }
    }
    let nodes = order.map { k in
        GenNode(id: k, label: counts[k]!.label, qid: nil, wikipedia: nil, family: "Other", style: nil,
                count: counts[k]!.n, ownCount: counts[k]!.n, parents: [], tags: [k])
    }
    return GenGraph(nodes: nodes)
}
