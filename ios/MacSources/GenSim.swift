import Foundation

/// Port of `web/js/genre-sim.js`: link springs, Barnes-Hut repulsion, centring, collision, alpha decay and a slow bounded drift.
struct GenRNG {
    var a: UInt32

    mutating func next() -> Double {
        a = a &+ 0x6D2B_79F5
        var t = (a ^ (a >> 15)) &* (1 | a)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return Double(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

final class GenBody {
    let id: String
    var data: GenNode
    var x = Double.nan
    var y = Double.nan
    var vx = 0.0
    var vy = 0.0
    var fx: Double?
    var fy: Double?
    var r: Double
    var phase = 0.0
    var fi: Int
    var fiPrev: Int
    var mix = 1.0

    init(data: GenNode) {
        id = data.id
        self.data = data
        r = genNodeRadius(data.count)
        fi = GenFamily.index(data.family)
        fiPrev = fi
    }
}

struct GenLink {
    let s: GenBody
    let t: GenBody
    let related: Bool
    var strength = 1.0
    var dist = 56.0
    var bias = 0.5
}

private final class GenQuad {
    let x0: Double
    let y0: Double
    let size: Double
    var mass = 0.0
    var cx = 0.0
    var cy = 0.0
    var kids: [GenQuad?]?
    var leaf: [(GenBody, Double)]?

    init(_ x0: Double, _ y0: Double, _ size: Double) { self.x0 = x0; self.y0 = y0; self.size = size }
}

final class GenSim {
    private(set) var bodies: [GenBody]
    private(set) var links: [GenLink] = []
    private var rng: GenRNG
    private let breathing: Bool
    private let charge = 70.0
    private let gravity = 0.035
    private var alpha = 1.0
    private var alphaTarget: Double
    private var ticks = 0.0

    private static let alphaMin = 0.001
    private static let alphaDecay = 1 - pow(0.001, 1.0 / 300)
    private static let velocityDecay = 0.4
    private static let theta2 = 0.81
    private static let maxV = 40.0
    private static let rest = 0.012

    init(bodies: [GenBody], edges: [GenEdge], seed: UInt32 = 1, breathing: Bool = true, linkDistance: Double = 56) {
        self.bodies = bodies
        self.breathing = breathing
        rng = GenRNG(a: seed)
        alphaTarget = breathing ? Self.rest : 0
        var byId: [String: GenBody] = [:]
        for (i, n) in bodies.enumerated() {
            if !n.x.isFinite || !n.y.isFinite {
                let rad = 12 * (0.5 + Double(i)).squareRoot()
                let ang = Double(i) * Double.pi * (3 - 5.0.squareRoot())
                n.x = rad * cos(ang) + (rng.next() - 0.5) * 2
                n.y = rad * sin(ang) + (rng.next() - 0.5) * 2
            }
            n.phase = rng.next() * Double.pi * 2
            byId[n.id] = n
        }
        var deg: [String: Int] = Dictionary(uniqueKeysWithValues: bodies.map { ($0.id, 0) })
        var ls: [GenLink] = []
        for e in edges {
            guard let s = byId[e.source], let t = byId[e.target], s !== t else { continue }
            ls.append(GenLink(s: s, t: t, related: e.related))
            deg[s.id]! += 1
            deg[t.id]! += 1
        }
        for i in ls.indices {
            let ds = Double(deg[ls[i].s.id]!)
            let dt = Double(deg[ls[i].t.id]!)
            ls[i].strength = (ls[i].related ? 0.15 : 1) / min(ds, dt)
            ls[i].dist = (ls[i].related ? 1.6 : 1) * linkDistance + ls[i].s.r + ls[i].t.r
            ls[i].bias = ds / (ds + dt)
        }
        links = ls
    }

    var restTarget: Double { breathing ? Self.rest : 0 }
    func setAlphaTarget(_ v: Double) { alphaTarget = v }
    func reheat(_ a: Double = 0.5) { alpha = max(alpha, a) }

    func settle(_ n: Int = 300) {
        let was = alphaTarget
        alphaTarget = 0
        for _ in 0..<n { if !tick() { break } }
        alphaTarget = was
        if alphaTarget > 0, alpha < alphaTarget { alpha = alphaTarget }
    }

    @discardableResult
    func tick() -> Bool {
        if alphaTarget == 0, alpha < Self.alphaMin { return false }
        alpha += (alphaTarget - alpha) * Self.alphaDecay
        ticks += 1
        linkForce()
        chargeForce()
        collideForce()
        let amp = breathing ? 0.02 : 0
        for n in bodies { integrate(n, amp) }
        return true
    }

    private func weight(_ n: GenBody) -> Double { 1 + n.r * 0.12 }

    private func linkForce() {
        for l in links {
            let s = l.s
            let t = l.t
            var dx = t.x + t.vx - s.x - s.vx
            var dy = t.y + t.vy - s.y - s.vy
            if dx == 0 { dx = (rng.next() - 0.5) * 1e-4 }
            if dy == 0 { dy = (rng.next() - 0.5) * 1e-4 }
            let d = hypot(dx, dy)
            let k = ((d - l.dist) / (d == 0 ? 1e-6 : d)) * alpha * l.strength
            dx *= k; dy *= k
            t.vx -= dx * (1 - l.bias); t.vy -= dy * (1 - l.bias)
            s.vx += dx * l.bias; s.vy += dy * l.bias
        }
    }

    private func insert(_ cell: GenQuad, _ n: GenBody, _ w: Double, _ depth: Int = 0) {
        let total = cell.mass + w
        cell.cx = (cell.cx * cell.mass + n.x * w) / total
        cell.cy = (cell.cy * cell.mass + n.y * w) / total
        cell.mass = total
        if cell.kids == nil, cell.leaf == nil { cell.leaf = [(n, w)]; return }
        if cell.kids == nil {
            if depth > 24 { cell.leaf!.append((n, w)); return }
            let old = cell.leaf!
            cell.leaf = nil
            cell.kids = [nil, nil, nil, nil]
            cell.mass = 0; cell.cx = 0; cell.cy = 0
            for (b, bw) in old { insert(cell, b, bw, depth + 1) }
            insert(cell, n, w, depth + 1)
            return
        }
        let h = cell.size / 2
        let right = n.x >= cell.x0 + h ? 1 : 0
        let down = n.y >= cell.y0 + h ? 1 : 0
        let i = down * 2 + right
        if cell.kids![i] == nil { cell.kids![i] = GenQuad(cell.x0 + Double(right) * h, cell.y0 + Double(down) * h, h) }
        insert(cell.kids![i]!, n, w, depth + 1)
    }

    private func leafForce(_ n: GenBody, _ c: GenQuad) {
        for (o, ow) in c.leaf ?? [] where o !== n {
            var ex = o.x - n.x
            var ey = o.y - n.y
            var e2 = ex * ex + ey * ey
            if e2 == 0 { ex = (rng.next() - 0.5) * 1e-3; ey = (rng.next() - 0.5) * 1e-3; e2 = ex * ex + ey * ey }
            if e2 < 25 { e2 = (25 * e2).squareRoot() }
            let f = (charge * alpha * ow) / e2
            n.vx -= ex * f; n.vy -= ey * f
        }
    }

    private func chargeOn(_ n: GenBody, _ root: GenQuad) {
        var stack = [root]
        while let c = stack.popLast() {
            if c.mass == 0 { continue }
            let dx = c.cx - n.x
            let dy = c.cy - n.y
            var d2 = dx * dx + dy * dy
            if let kids = c.kids, d2 == 0 || (c.size * c.size) / d2 >= Self.theta2 {
                for k in kids { if let k { stack.append(k) } }
                continue
            }
            if c.leaf != nil { leafForce(n, c); continue }
            if d2 < 25 { d2 = (25 * d2).squareRoot() }
            let f = (charge * alpha * c.mass) / d2
            n.vx -= dx * f; n.vy -= dy * f
        }
    }

    private func chargeForce() {
        guard !bodies.isEmpty else { return }
        var x0 = Double.infinity
        var y0 = Double.infinity
        var x1 = -Double.infinity
        var y1 = -Double.infinity
        for n in bodies { x0 = min(x0, n.x); x1 = max(x1, n.x); y0 = min(y0, n.y); y1 = max(y1, n.y) }
        let root = GenQuad(x0, y0, max(x1 - x0, y1 - y0, 1) + 1)
        for n in bodies { insert(root, n, weight(n)) }
        for n in bodies { chargeOn(n, root) }
    }

    private func collidePair(_ a: GenBody, _ b: GenBody) {
        var dx = b.x + b.vx - a.x - a.vx
        var dy = b.y + b.vy - a.y - a.vy
        let minD = a.r + b.r + 4
        var d2 = dx * dx + dy * dy
        if d2 >= minD * minD { return }
        if d2 == 0 { dx = (rng.next() - 0.5) * 1e-3; dy = (rng.next() - 0.5) * 1e-3; d2 = dx * dx + dy * dy }
        let d = d2.squareRoot()
        let push = ((minD - d) / d) * 0.7
        let wa = (b.r * b.r) / (a.r * a.r + b.r * b.r)
        a.vx -= dx * push * wa; a.vy -= dy * push * wa
        b.vx += dx * push * (1 - wa); b.vy += dy * push * (1 - wa)
    }

    private func collideForce() {
        let maxR = bodies.reduce(0) { max($0, $1.r) }
        let cell = 2 * maxR + 8
        var grid: [Int64: [GenBody]] = [:]
        func key(_ gx: Int, _ gy: Int) -> Int64 { Int64(gx) << 32 ^ Int64(truncatingIfNeeded: gy) & 0xFFFF_FFFF }
        for n in bodies { grid[key(Int((n.x / cell).rounded(.down)), Int((n.y / cell).rounded(.down))), default: []].append(n) }
        for a in bodies {
            let cx = Int((a.x / cell).rounded(.down))
            let cy = Int((a.y / cell).rounded(.down))
            for gx in (cx - 1)...(cx + 1) {
                for gy in (cy - 1)...(cy + 1) {
                    for b in grid[key(gx, gy)] ?? [] where b.id > a.id { collidePair(a, b) }
                }
            }
        }
    }

    private func clampV(_ v: Double) -> Double { max(-Self.maxV, min(Self.maxV, v)) }

    private func integrate(_ n: GenBody, _ amp: Double) {
        n.vx -= n.x * gravity * alpha
        n.vy -= n.y * gravity * alpha
        if amp != 0 {
            n.vx += cos(ticks * 0.021 + n.phase) * amp
            n.vy += sin(ticks * 0.017 + n.phase * 1.7) * amp
        }
        if let fx = n.fx { n.x = fx; n.vx = 0 } else { n.vx = clampV(n.vx * (1 - Self.velocityDecay)); n.x += n.vx }
        if let fy = n.fy { n.y = fy; n.vy = 0 } else { n.vy = clampV(n.vy * (1 - Self.velocityDecay)); n.y += n.vy }
        if !n.x.isFinite || !n.y.isFinite {
            n.x = (rng.next() - 0.5) * 10; n.y = (rng.next() - 0.5) * 10; n.vx = 0; n.vy = 0
        }
    }
}
