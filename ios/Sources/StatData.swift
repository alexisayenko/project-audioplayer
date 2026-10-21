import Foundation

enum StatMode: String, CaseIterable, Identifiable {
    case family, decade, audio, none
    var id: String { rawValue }

    var label: String {
        switch self {
        case .family: "Genre family"
        case .decade: "Decade"
        case .audio: "Audio on server"
        case .none: "None"
        }
    }
}

struct StatRange: Equatable {
    var lo: Double
    var hi: Double
    var span: Double { hi - lo }
}

struct StatPoint: Identifiable {
    let id: String
    let track: Track
    let year: Int
    let bpm: Double
    let x: Double
    let y: Double
    var group = ""
    var color = StatData.neutral
}

struct StatGroup: Identifiable {
    let key: String
    let label: String
    let order: Int
    var count = 0
    var color = StatData.neutral
    var neutral = false
    var other = false
    var id: String { key }
}

struct StatScale {
    let lo: Double
    let hi: Double
    let p0: Double
    let p1: Double
    private var k: Double { (p1 - p0) / (hi - lo) }
    func to(_ v: Double) -> Double { p0 + (v - lo) * k }
    func from(_ p: Double) -> Double { lo + (p - p0) / k }
}

struct StatGraph: Decodable {
    struct Node: Decodable {
        var id: String
        var label: String
        var family: String?
        var tags: [String]?
    }

    var nodes: [Node]?
    var pending: Bool?
}

enum StatData {
    static let families = [
        "Electronic", "Rock", "Pop", "Hip Hop", "Jazz", "Funk / Soul", "Classical", "Reggae", "Latin",
        "Blues", "Folk, World, & Country", "Other",
    ]
    static let bpmDefault = StatRange(lo: 60, hi: 200)
    static let minYearSpan = 10.0
    static let minZoomYears = 2.0
    static let minZoomBPM = 8.0
    static let jitterYear = 0.34
    static let jitterBPM = 1.4
    static let paletteSize = 12
    static let familyPaletteSize = 16
    static let neutral = -1
    static let other = "Other"

    static var maxYear: Int { Calendar.current.component(.year, from: Date()) + 1 }
    static func validYear(_ v: Int?) -> Bool { v.map { (1900...maxYear).contains($0) } ?? false }
    static func validBPM(_ v: Double?) -> Bool { v.map { $0.isFinite && $0 >= 20 && $0 <= 300 } ?? false }

    static func familyIndex(_ family: String) -> Int {
        family == other ? familyPaletteSize - 1 : (families.firstIndex(of: family) ?? familyPaletteSize - 1)
    }

    static func split(_ songs: [Track]) -> (plotted: [Track], skipped: Int) {
        var plotted: [Track] = []
        var skipped = 0
        for s in songs {
            if validYear(s.year) && validBPM(s.bpm) { plotted.append(s) } else { skipped += 1 }
        }
        return (plotted, skipped)
    }

    private static func hash(_ s: String) -> UInt32 {
        var h: UInt32 = 2166136261
        for u in s.utf16 {
            h ^= UInt32(u)
            h = h &* 16777619
        }
        return h
    }

    static func jitter(_ id: String) -> (dx: Double, dy: Double) {
        let h = hash(id)
        let a = Double(h & 0xffff) / 65536
        let b = Double(hash("\(h):\(id)") & 0xffff) / 65536
        return ((a * 2 - 1) * jitterYear, (b * 2 - 1) * jitterBPM)
    }

    static func makePoint(_ t: Track) -> StatPoint {
        let j = jitter(t.id)
        let year = t.year ?? 0
        let bpm = t.bpm ?? 0
        return StatPoint(id: t.id, track: t, year: year, bpm: bpm, x: Double(year) + j.dx, y: bpm + j.dy)
    }

    static func extentX(_ years: [Int]) -> StatRange {
        guard let mn = years.min(), let mx = years.max() else { return StatRange(lo: 2000, hi: 2000 + minYearSpan) }
        var lo = Double(mn) - 1
        var hi = Double(mx) + 1
        if hi - lo < minYearSpan {
            let extra = minYearSpan - (hi - lo)
            lo -= (extra / 2).rounded(.down)
            hi = lo + minYearSpan
        }
        return StatRange(lo: lo, hi: hi)
    }

    static func extentY(_ bpms: [Double]) -> StatRange {
        var r = bpmDefault
        if let mn = bpms.min(), let mx = bpms.max() {
            if mn < r.lo { r.lo = max(0, ((mn - 5) / 20).rounded(.down) * 20) }
            if mx > r.hi { r.hi = ((mx + 5) / 20).rounded(.up) * 20 }
        }
        return r
    }

    static func tickStep(span: Double, maxTicks: Double, minStep: Double = 1) -> Double {
        let want = span / max(1, maxTicks)
        for s in [1.0, 2, 5, 10, 20, 25, 50, 100] where s >= want && s >= minStep { return s }
        return (want / 100).rounded(.up) * 100
    }

    static func ticks(lo: Double, hi: Double, step: Double) -> [Int] {
        var out: [Int] = []
        var v = (lo / step).rounded(.up) * step
        while v <= hi + 1e-9 {
            out.append(Int(v.rounded()))
            v += step
        }
        return out
    }

    static func clampLo(_ r: StatRange, floor: Double = 0) -> StatRange {
        r.lo >= floor ? r : StatRange(lo: floor, hi: floor + r.span)
    }

    static func zoom(_ r: StatRange, anchor: Double, factor: Double, minSpan: Double, maxSpan: Double) -> StatRange {
        let span = min(maxSpan, max(minSpan, r.span * factor))
        let t = r.hi == r.lo ? 0.5 : (anchor - r.lo) / r.span
        let lo = anchor - t * span
        return StatRange(lo: lo, hi: lo + span)
    }

    static func center(_ r: StatRange, on bounds: StatRange) -> StatRange {
        let lo = (bounds.lo + bounds.hi) / 2 - r.span / 2
        return StatRange(lo: lo, hi: lo + r.span)
    }

    static func pan(_ r: StatRange, delta: Double, bounds: StatRange) -> StatRange {
        let span = r.span
        let lo = min(bounds.hi - span / 2, max(bounds.lo - span / 2, r.lo + delta))
        return StatRange(lo: lo, hi: lo + span)
    }

    static func decade(_ year: Int) -> Int { Int((Double(year) / 10).rounded(.down)) * 10 }

    private static func normGenre(_ v: String) -> String {
        v.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    static func genres(_ t: Track) -> [(key: String, label: String)] {
        var seen = Set<String>()
        var out: [(String, String)] = []
        for tag in t.tags ?? [] {
            let (k, v) = splitTag(tag)
            guard k.trimmingCharacters(in: .whitespaces).lowercased() == "genre" else { continue }
            let key = normGenre(v)
            if key.isEmpty || !seen.insert(key).inserted { continue }
            out.append((key, key))
        }
        return out
    }

    struct Resolver {
        let owner: [String: String]
        let familyOf: [String: String]

        init(_ graph: StatGraph) {
            var owner: [String: String] = [:]
            var familyOf: [String: String] = [:]
            for n in graph.nodes ?? [] {
                familyOf[n.id] = n.family
                let keys = (n.tags?.isEmpty == false) ? n.tags! : [n.label.lowercased()]
                for k in keys { owner[StatData.normGenre(k)] = n.id }
            }
            self.owner = owner
            self.familyOf = familyOf
        }

        func family(of t: Track) -> String {
            for g in StatData.genres(t) {
                if let id = owner[g.key], let fam = familyOf[id], !fam.isEmpty { return fam }
            }
            return StatData.other
        }
    }

    static func families(_ resolver: Resolver?, _ songs: [Track], failed: Bool) -> [String: String]? {
        guard let resolver else { return failed ? [:] : nil }
        var out: [String: String] = [:]
        for s in songs {
            let f = resolver.family(of: s)
            if f != other { out[s.id] = f }
        }
        return out
    }

    private static func group(_ t: Track, mode: StatMode, families: [String: String]?, hasAudio: Bool) -> StatGroup {
        switch mode {
        case .family:
            guard let families else { return StatGroup(key: "all", label: "All songs", order: 0) }
            let fam = families[t.id] ?? other
            return StatGroup(key: "f:\(fam)", label: fam, order: familyIndex(fam), other: fam == other)
        case .decade:
            let d = decade(t.year ?? 0)
            return StatGroup(key: String(d), label: "\(d)s", order: d)
        case .audio:
            return hasAudio
                ? StatGroup(key: "audio", label: "Audio on server", order: 0)
                : StatGroup(key: "noaudio", label: "No audio", order: 1, neutral: true)
        case .none:
            return StatGroup(key: "all", label: "All songs", order: 0)
        }
    }

    static func assign(_ points: inout [StatPoint], mode: StatMode, families: [String: String]?, hasAudio: (Track) -> Bool) -> [StatGroup] {
        var groups: [String: StatGroup] = [:]
        for i in points.indices {
            let g = group(points[i].track, mode: mode, families: families, hasAudio: hasAudio(points[i].track))
            var e = groups[g.key] ?? g
            e.count += 1
            groups[g.key] = e
            points[i].group = g.key
        }
        let pending = mode == .family && families == nil
        let byOrder: (StatGroup, StatGroup) -> Bool = { $0.order < $1.order }
        let byCount: (StatGroup, StatGroup) -> Bool = {
            if $0.other != $1.other { return !$0.other }
            if $0.count != $1.count { return $0.count > $1.count }
            return $0.order < $1.order
        }
        var list = Array(groups.values).sorted(by: mode == .family && !pending ? byCount : byOrder)
        var next = 0
        for i in list.indices {
            if mode == .none || list[i].neutral || pending { continue }
            list[i].color = mode == .family ? list[i].order : next
            next += 1
        }
        let colors = Dictionary(uniqueKeysWithValues: list.map { ($0.key, $0.color) })
        for i in points.indices { points[i].color = colors[points[i].group] ?? neutral }
        return list
    }

    static func colorIndex(_ color: Int, size: Int) -> Int { color < 0 ? neutral : color % size }

    static func countText(_ plotted: Int, _ total: Int) -> String { "\(plotted) of \(total) songs plotted" }

    static func skippedText(_ n: Int) -> String {
        n == 0 ? "" : "\(n) \(n == 1 ? "song" : "songs") without year or BPM \(n == 1 ? "is" : "are") not shown"
    }

    static func chartLabel(_ n: Int) -> String {
        "Scatter plot of \(n) \(n == 1 ? "song" : "songs"): year on the horizontal axis, BPM on the vertical axis."
    }
}

struct StatItem {
    let id: String
    var px: Double
    var py: Double
    let group: String
}

struct StatIndex {
    private let cell = 24.0
    private var cells: [Int64: [Int]] = [:]
    private let items: [StatItem]

    private static func key(_ cx: Int, _ cy: Int) -> Int64 { Int64(cx) << 32 ^ Int64(UInt32(truncatingIfNeeded: cy)) }

    init(_ items: [StatItem]) {
        self.items = items
        for (i, it) in items.enumerated() {
            cells[Self.key(Int((it.px / cell).rounded(.down)), Int((it.py / cell).rounded(.down))), default: []].append(i)
        }
    }

    func near(x: Double, y: Double, r: Double, ok: (StatItem) -> Bool) -> Int? {
        var best: Int?
        var bestD = r * r
        let x0 = Int(((x - r) / cell).rounded(.down))
        let x1 = Int(((x + r) / cell).rounded(.down))
        let y0 = Int(((y - r) / cell).rounded(.down))
        let y1 = Int(((y + r) / cell).rounded(.down))
        guard x0 <= x1, y0 <= y1 else { return nil }
        for cx in x0...x1 {
            for cy in y0...y1 {
                for i in cells[Self.key(cx, cy)] ?? [] where ok(items[i]) {
                    let d = (items[i].px - x) * (items[i].px - x) + (items[i].py - y) * (items[i].py - y)
                    if d <= bestD { best = i; bestD = d }
                }
            }
        }
        return best
    }
}

enum StatNav {
    static func inRect(_ items: [StatItem], _ a: CGPoint, _ b: CGPoint, ok: (StatItem) -> Bool) -> [Int] {
        let x0 = min(a.x, b.x)
        let x1 = max(a.x, b.x)
        let y0 = min(a.y, b.y)
        let y1 = max(a.y, b.y)
        return items.indices.filter { i in
            let it = items[i]
            return ok(it) && it.px >= x0 && it.px <= x1 && it.py >= y0 && it.py <= y1
        }
    }

    static func neighbour(_ items: [StatItem], from: Int, dir: (Double, Double), ok: (StatItem) -> Bool) -> Int {
        guard items.indices.contains(from) else { return -1 }
        let o = items[from]
        var best = from
        var bestScore = Double.infinity
        for i in items.indices where i != from && ok(items[i]) {
            let dx = items[i].px - o.px
            let dy = items[i].py - o.py
            let along = dx * dir.0 + dy * dir.1
            if along <= 0 { continue }
            let across = abs(dx * dir.1 - dy * dir.0)
            let score = along + across * 2
            if score < bestScore { bestScore = score; best = i }
        }
        return best
    }

    static func first(_ items: [StatItem], ok: (StatItem) -> Bool) -> Int {
        var best = -1
        for i in items.indices where ok(items[i]) {
            if best < 0 || items[i].px < items[best].px { best = i }
        }
        return best
    }
}
