import AppKit
import SwiftUI

struct GenTransform {
    var k = 1.0
    var x = 0.0
    var y = 0.0
}
struct GenInsets {
    var t = 56.0
    var r = 0.0
    var b = 16.0
    var l = 16.0
}

private struct GenBox {
    var x0: Double
    var y0: Double
    var x1: Double
    var y1: Double
}

private struct GenLabelCand {
    var id: String
    var x: Double
    var y: Double
    var w: Double
    var h: Double
    var force: Bool
}

/// Layout, hit-testing and drawing of the genre graph: the port of `web/js/genre-graph.js` and `genre-view.js`.
@MainActor
final class GenEngine {
    static let minK = 0.15
    static let maxK = 6.0
    static let barGap = 8.0

    private(set) var size = CGSize(width: 1, height: 1)
    private(set) var tf = GenTransform()
    private(set) var bodies: [GenBody] = []
    private(set) var byId: [String: GenBody] = [:]
    private(set) var selSet = Set<String>()
    private var sim: GenSim?
    private var links: [GenLink] = []
    private var nbr: [String: Set<String>] = [:]
    private var anc: [String: Int] = [:]
    private var withAnc = false
    private var hoverID: String?
    private var marked = Set<String>()
    private var hiddenFI = Set<Int>()
    private var anim: (from: GenTransform, to: GenTransform, t: Double)?
    private var autoFitAt: TimeInterval = 0
    private var userMoved = false
    private var needFit = true
    private var insets = GenInsets()
    private var order: [GenBody] = []
    private var lastGraph: GenGraph?
    private var graph: GenGraph?
    private var widths: [String: Double] = [:]
    private var drag: (node: GenBody?, sx: Double, sy: Double, moved: Bool, lastX: Double, lastY: Double)?
    private var lastClick: (id: String, at: TimeInterval)?
    let reduced: Bool

    var onSelect: ((_ ids: [String]) -> Void)?
    var onHover: ((_ id: String?, _ at: CGPoint) -> Void)?
    var onRedraw: (() -> Void)?

    init(reduced: Bool) { self.reduced = reduced }

    private func request() { if reduced { onRedraw?() } }
    private func visible(_ n: GenBody) -> Bool { !hiddenFI.contains(n.fi) }
    var visibleBodies: [GenBody] { bodies.filter(visible) }
    var nodeCount: Int { bodies.count }

    // MARK: geometry

    func toWorld(_ sx: Double, _ sy: Double) -> (Double, Double) { ((sx - tf.x) / tf.k, (sy - tf.y) / tf.k) }

    func nodeAt(_ sx: Double, _ sy: Double) -> GenBody? {
        let (wx, wy) = toWorld(sx, sy)
        let slack = 3 / tf.k
        for n in bodies.reversed() where visible(n) {
            let dx = n.x - wx
            let dy = n.y - wy
            let rr = n.r + slack
            if dx * dx + dy * dy <= rr * rr { return n }
        }
        return nil
    }

    private func bbox(_ list: [GenBody]) -> GenBox {
        var b = GenBox(x0: .infinity, y0: .infinity, x1: -.infinity, y1: -.infinity)
        for n in list {
            b.x0 = min(b.x0, n.x - n.r); b.x1 = max(b.x1, n.x + n.r)
            b.y0 = min(b.y0, n.y - n.r); b.y1 = max(b.y1, n.y + n.r)
        }
        return b
    }

    private func fitTransform(_ b: GenBox, pad: Double, minK: Double, maxK: Double) -> GenTransform {
        let w = size.width
        let h = size.height
        let aw = max(1, w - insets.l - insets.r - 2 * pad)
        let ah = max(1, h - insets.t - insets.b - 2 * pad)
        let bw = max(b.x1 - b.x0, 40)
        let bh = max(b.y1 - b.y0, 40)
        let k = min(maxK, max(minK, min(aw / bw, ah / bh)))
        let cx = insets.l + (w - insets.l - insets.r) / 2
        let cy = insets.t + (h - insets.t - insets.b) / 2
        return GenTransform(k: k, x: cx - (b.x0 + b.x1) / 2 * k, y: cy - (b.y0 + b.y1) / 2 * k)
    }

    private func fitTo(_ list: [GenBody], pad: Double = 32, maxK: Double = 2.2, animate: Bool = true) {
        guard !list.isEmpty else { return }
        let to = fitTransform(bbox(list), pad: pad, minK: Self.minK, maxK: maxK)
        if animate, !reduced { anim = (tf, to, 0) } else { tf = to; anim = nil }
        request()
    }

    func fit() { userMoved = false; fitTo(visibleBodies, animate: false) }

    func resize(_ s: CGSize) {
        let ow = size.width
        let oh = size.height
        size = CGSize(width: max(1, s.width), height: max(1, s.height))
        widths.removeAll()
        let laidOut = s.width > 10 && s.height > 10
        if laidOut, needFit, !bodies.isEmpty {
            fit()
            needFit = false
            autoFitAt = Date.timeIntervalSinceReferenceDate + 0.7
        } else if laidOut, ow > 10, oh > 10 {
            tf = GenTransform(k: tf.k, x: tf.x + (size.width - ow) / 2, y: tf.y + (size.height - oh) / 2)
            anim = nil
        }
    }

    func setInsets(top: Double) {
        let t = top + Self.barGap
        guard t != insets.t else { return }
        insets.t = t
        if !userMoved, !bodies.isEmpty { fitTo(visibleBodies) }
    }

    func zoom(_ factor: Double, at p: CGPoint? = nil) {
        zoomAt(factor, p.map { Double($0.x) } ?? size.width / 2, p.map { Double($0.y) } ?? size.height / 2)
    }

    func zoomAt(_ factor: Double, _ sx: Double, _ sy: Double) {
        let k = min(Self.maxK, max(Self.minK, tf.k * factor))
        let f = k / tf.k
        tf = GenTransform(k: k, x: sx - (sx - tf.x) * f, y: sy - (sy - tf.y) * f)
        anim = nil
        userMoved = true
        request()
    }

    func pan(dx: Double, dy: Double) {
        tf.x += dx; tf.y += dy
        userMoved = true
        request()
    }

    // MARK: selection

    func select(_ id: String?, center: Bool = false) {
        let n = id.flatMap { byId[$0] }
        selSet = n.map { [$0.id] } ?? []
        withAnc = true
        computeAnc()
        if let n, center { focus(n.id) }
        onSelect?(n.map { [$0.id] } ?? [])
        request()
    }

    private func computeAnc() {
        anc = [:]
        guard withAnc, let graph else { return }
        for f in selSet {
            for (id, d) in graph.ancestors(of: f) where byId[id] != nil && !selSet.contains(id) {
                if anc[id] == nil || anc[id]! > d { anc[id] = d }
            }
        }
    }

    func selectMany(_ ids: [String], fit doFit: Bool = true, ancestors: Bool = false) {
        var seen = Set<String>()
        let list = ids.filter { byId[$0] != nil && seen.insert($0).inserted }
        selSet = Set(list)
        withAnc = ancestors
        computeAnc()
        if !list.isEmpty, doFit {
            var group = Set(list).union(anc.keys)
            for id in list { group.formUnion((nbr[id] ?? []).filter { byId[$0] != nil }) }
            userMoved = true
            fitTo(group.compactMap { byId[$0] }, maxK: 2.4)
        }
        onSelect?(list)
        request()
    }

    func focus(_ id: String) {
        guard byId[id] != nil else { return }
        var group = Set([id]).union(nbr[id] ?? [])
        if selSet.contains(id) { group.formUnion(anc.keys) }
        fitTo(group.compactMap { byId[$0] }, maxK: 2.4)
    }

    func hoverID(_ id: String?) {
        let n = id.flatMap { byId[$0] }
        if n?.id != hoverID { hoverID = n?.id; request() }
    }

    func setMarked(_ ids: [String]) { marked = Set(ids); request() }

    func fitIDs(_ ids: [String]) {
        let list = ids.compactMap { byId[$0] }
        if !list.isEmpty { userMoved = true; fitTo(list, maxK: 2.4) }
    }

    func setHiddenFamilies(_ names: Set<String>) {
        hiddenFI = Set(names.map(GenFamily.index))
        if selSet.contains(where: { byId[$0].map { !visible($0) } ?? false }) { select(nil) }
        request()
    }

    // MARK: data

    private func sameTopology(_ prev: GenGraph?, _ next: GenGraph) -> Bool {
        guard let prev, prev.nodes.count == next.nodes.count, prev.edges.count == next.edges.count else { return false }
        for n in next.nodes where prev[n.id] == nil { return false }
        let before = Set(prev.edges)
        return next.edges.allSatisfy { before.contains($0) }
    }

    func update(_ g: GenGraph) {
        if bodies.isEmpty || !sameTopology(lastGraph, g) { setData(g); return }
        for d in g.nodes {
            guard let n = byId[d.id] else { continue }
            n.data = d
            n.r = genNodeRadius(d.count)
            let fi = GenFamily.index(d.family)
            if fi != n.fi { n.fiPrev = n.fi; n.fi = fi; n.mix = reduced ? 1 : 0 }
        }
        order = bodies.sorted { $0.r != $1.r ? $0.r > $1.r : $0.id < $1.id }
        lastGraph = g
        graph = g
        request()
    }

    private func setData(_ g: GenGraph) {
        let old = byId
        let wasEmpty = old.isEmpty
        bodies = g.nodes.map { d in
            let b = GenBody(data: d)
            if let p = old[d.id] { b.x = p.x; b.y = p.y; b.vx = p.vx; b.vy = p.vy; b.fiPrev = p.fi }
            return b
        }
        order = bodies.sorted { $0.r != $1.r ? $0.r > $1.r : $0.id < $1.id }
        lastGraph = g
        graph = g
        byId = Dictionary(uniqueKeysWithValues: bodies.map { ($0.id, $0) })
        nbr = Dictionary(uniqueKeysWithValues: bodies.map { ($0.id, Set<String>()) })
        for e in g.edges { nbr[e.source]?.insert(e.target); nbr[e.target]?.insert(e.source) }
        let s = GenSim(bodies: bodies, edges: g.edges, seed: 1, breathing: !reduced)
        sim = s
        links = s.links
        selSet = selSet.filter { byId[$0] != nil }
        computeAnc()
        hoverID = nil
        if wasEmpty { s.settle(reduced ? 500 : 240) } else { s.reheat(0.4) }
        if needFit, !bodies.isEmpty, size.width > 10, size.height > 10 {
            fit()
            needFit = false
            autoFitAt = Date.timeIntervalSinceReferenceDate + 0.7
        }
        request()
    }

    // MARK: pointer

    func beginDrag(_ sx: Double, _ sy: Double) {
        let hit = nodeAt(sx, sy)
        drag = (hit, sx, sy, false, sx, sy)
        anim = nil
    }

    func moveDrag(_ sx: Double, _ sy: Double) {
        guard var d = drag else { return }
        if !d.moved {
            guard hypot(sx - d.sx, sy - d.sy) >= 4 else { return }
            if d.node != nil, !reduced { sim?.setAlphaTarget(0.3) }
        }
        d.moved = true
        if let n = d.node {
            let (wx, wy) = toWorld(sx, sy)
            n.fx = wx; n.fy = wy
            if reduced { n.x = wx; n.y = wy }
        } else {
            tf.x += sx - d.lastX
            tf.y += sy - d.lastY
            userMoved = true
        }
        d.lastX = sx; d.lastY = sy
        drag = d
        request()
    }

    var isDragging: Bool { drag != nil }
    var hoveredID: String? { hoverID }

    func endDrag() {
        guard let d = drag else { return }
        drag = nil
        if let n = d.node {
            n.fx = nil; n.fy = nil
            if d.moved { sim?.setAlphaTarget(sim?.restTarget ?? 0) }
            else {
                let now = Date.timeIntervalSinceReferenceDate
                select(n.id)
                if let last = lastClick, last.id == n.id, now - last.at < 0.4 { focus(n.id); lastClick = nil }
                else { lastClick = (n.id, now) }
            }
        } else if !d.moved {
            select(nil)
        }
        request()
    }

    func hover(at p: CGPoint?) {
        guard let p else { hoverID = nil; onHover?(nil, .zero); request(); return }
        let n = nodeAt(p.x, p.y)
        if n?.id != hoverID { hoverID = n?.id; request() }
        onHover?(n?.id, p)
    }

    // MARK: frame

    private func stepAnim() {
        guard var a = anim else { return }
        a.t = min(1, a.t + 0.07)
        let e = 1 - pow(1 - a.t, 3)
        tf = GenTransform(
            k: a.from.k + (a.to.k - a.from.k) * e,
            x: a.from.x + (a.to.x - a.from.x) * e,
            y: a.from.y + (a.to.y - a.from.y) * e)
        anim = a.t >= 1 ? nil : a
    }

    func step() {
        if let sim, !reduced { sim.tick() }
        if anim != nil { stepAnim() }
        if autoFitAt != 0, Date.timeIntervalSinceReferenceDate > autoFitAt {
            autoFitAt = 0
            if !userMoved { fitTo(visibleBodies) }
        }
        for n in bodies where n.mix < 1 { n.mix = min(1, n.mix + 0.04) }
    }

    // MARK: drawing

    private func ancAlpha(_ depth: Int, _ top: Double, _ floor: Double) -> Double { max(floor, top - 0.12 * Double(depth - 1)) }

    private func screen(_ n: GenBody) -> CGPoint { CGPoint(x: n.x * tf.k + tf.x, y: n.y * tf.k + tf.y) }

    func draw(_ ctx: GraphicsContext, size: CGSize) {
        let k = tf.k
        let focus: Set<String>? = selSet.isEmpty ? nil : selSet
        var near = Set<String>()
        if let focus { for f in focus { near.formUnion(nbr[f] ?? []) } }
        func isOn(_ n: GenBody) -> Bool { focus == nil || focus!.contains(n.id) || near.contains(n.id) || anc[n.id] != nil }
        let edge = DS.Color.inkMuted
        let hi = DS.Color.accentInk

        for l in links where visible(l.s) && visible(l.t) {
            let chain = !l.related && anc[l.t.id] != nil && (anc[l.s.id] != nil || (focus?.contains(l.s.id) ?? false))
            let on = focus == nil || focus!.contains(l.s.id) || focus!.contains(l.t.id) || chain
            let alpha: Double
            if chain { alpha = ancAlpha(anc[l.t.id]!, 0.95, 0.45) }
            else if !on { alpha = 0.06 }
            else if focus != nil { alpha = 0.95 }
            else { alpha = 0.5 }
            let color = (on && focus != nil ? hi : edge).opacity(alpha)
            let a = screen(l.s)
            let b = screen(l.t)
            var p = Path()
            p.move(to: a)
            p.addLine(to: b)
            ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: on && focus != nil ? 1.8 : 1, dash: l.related ? [4, 4] : []))
            let d = hypot(l.t.x - l.s.x, l.t.y - l.s.y)
            if !l.related, k > 0.45, d > l.t.r + 10 / k, d > 0 {
                let ux = (b.x - a.x) / (d * k)
                let uy = (b.y - a.y) / (d * k)
                let tipX = b.x - ux * (l.t.r + 1) * k
                let tipY = b.y - uy * (l.t.r + 1) * k
                let s = 6.0
                var arrow = Path()
                arrow.move(to: CGPoint(x: tipX, y: tipY))
                arrow.addLine(to: CGPoint(x: tipX - ux * s - uy * s * 0.5, y: tipY - uy * s + ux * s * 0.5))
                arrow.addLine(to: CGPoint(x: tipX - ux * s + uy * s * 0.5, y: tipY - uy * s - ux * s * 0.5))
                arrow.closeSubpath()
                ctx.fill(arrow, with: .color(color))
            }
        }

        let halo = DS.Color.surface
        let ring = DS.Color.accentInk
        for n in bodies where visible(n) {
            let alpha: Double
            if !isOn(n) { alpha = 0.16 }
            else if let d = anc[n.id], !near.contains(n.id) { alpha = ancAlpha(d, 1, 0.55) }
            else { alpha = 1 }
            let c = screen(n)
            let r = n.r * k
            if c.x < -r - 20 || c.x > size.width + r + 20 || c.y < -r - 20 || c.y > size.height + r + 20 { continue }
            let circle = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
            if n.mix < 1 {
                ctx.fill(circle, with: .color(GenFamily.color(n.fiPrev).opacity(alpha)))
                ctx.fill(circle, with: .color(GenFamily.color(n.fi).opacity(alpha * n.mix)))
            } else {
                ctx.fill(circle, with: .color(GenFamily.color(n.fi).opacity(alpha)))
            }
            ctx.stroke(circle, with: .color(halo.opacity(alpha)), lineWidth: 1.5)
            if marked.contains(n.id) {
                let rr = r + 6
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - rr, y: c.y - rr, width: 2 * rr, height: 2 * rr)), with: .color(ring), lineWidth: 2)
            }
            let selected = selSet.contains(n.id)
            if selected || n.id == hoverID {
                let rr = r + 3
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - rr, y: c.y - rr, width: 2 * rr, height: 2 * rr)), with: .color(ring), lineWidth: selected ? 2.5 : 1.5)
            }
        }
        drawLabels(ctx, size: size, focus: focus, isOn: isOn)
    }

    private func labelWidth(_ text: String) -> Double {
        if let w = widths[text] { return w }
        let w = Double((text as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 12)]).width)
        widths[text] = w
        return w
    }

    private func drawLabels(_ ctx: GraphicsContext, size: CGSize, focus: Set<String>?, isOn: (GenBody) -> Bool) {
        var cands: [GenLabelCand] = []
        var byLabel: [String: GenBody] = [:]
        for n in order where visible(n) {
            let force = focus != nil && isOn(n)
            if focus != nil, !force { continue }
            let c = screen(n)
            if c.x < -80 || c.x > size.width + 80 || c.y < -40 || c.y > size.height + 40 { continue }
            if !force, n.r * tf.k < 2.5 { continue }
            cands.append(GenLabelCand(id: n.id, x: c.x, y: c.y + n.r * tf.k + 3, w: labelWidth(n.data.label), h: 14, force: force))
            byLabel[n.id] = n
        }
        let shown = placeLabels(cands)
        let offsets: [(Double, Double)] = [(-1.5, 0), (1.5, 0), (0, -1.5), (0, 1.5), (-1.1, -1.1), (1.1, -1.1), (-1.1, 1.1), (1.1, 1.1)]
        for c in cands where shown.contains(c.id) {
            guard let n = byLabel[c.id] else { continue }
            let font = Font.system(size: 12)
            let haloText = ctx.resolve(Text(n.data.label).font(font).foregroundStyle(DS.Color.surface))
            let text = ctx.resolve(Text(n.data.label).font(font).foregroundStyle(DS.Color.ink))
            for (dx, dy) in offsets { ctx.draw(haloText, at: CGPoint(x: c.x + dx, y: c.y + dy), anchor: .top) }
            ctx.draw(text, at: CGPoint(x: c.x, y: c.y), anchor: .top)
        }
    }

    private func placeLabels(_ cands: [GenLabelCand], cell: Double = 64, gap: Double = 2) -> Set<String> {
        var grid: [Int: [GenBox]] = [:]
        var shown = Set<String>()
        func keys(_ r: GenBox) -> [Int] {
            var out: [Int] = []
            for gx in Int((r.x0 / cell).rounded(.down))...Int((r.x1 / cell).rounded(.down)) {
                for gy in Int((r.y0 / cell).rounded(.down))...Int((r.y1 / cell).rounded(.down)) { out.append(gx &* 100_003 &+ gy) }
            }
            return out
        }
        func place(_ c: GenLabelCand) {
            let box = GenBox(x0: c.x - c.w / 2 - gap, y0: c.y - gap, x1: c.x + c.w / 2 + gap, y1: c.y + c.h + gap)
            let ks = keys(box)
            if !c.force {
                for k in ks { for o in grid[k] ?? [] where box.x0 < o.x1 && o.x0 < box.x1 && box.y0 < o.y1 && o.y0 < box.y1 { return } }
            }
            for k in ks { grid[k, default: []].append(box) }
            shown.insert(c.id)
        }
        for c in cands where c.force { place(c) }
        for c in cands where !c.force { place(c) }
        return shown
    }
}
