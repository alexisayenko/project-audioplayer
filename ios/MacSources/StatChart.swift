import AppKit
import SwiftUI

enum StatPalette {
    static let colors: [Color] = [
        DS.Chart.chart0, DS.Chart.chart1, DS.Chart.chart2, DS.Chart.chart3, DS.Chart.chart4, DS.Chart.chart5,
        DS.Chart.chart6, DS.Chart.chart7, DS.Chart.chart8, DS.Chart.chart9, DS.Chart.chart10, DS.Chart.chart11,
        DS.Chart.chart12, DS.Chart.chart13, DS.Chart.chart14, DS.Chart.chart15,
    ]

    static func color(_ color: Int, family: Bool) -> Color {
        let i = StatData.colorIndex(color, size: family ? StatData.familyPaletteSize : StatData.paletteSize)
        return colors[i < 0 ? colors.count - 1 : i]
    }
}

/// Hover, focus, rubber band and selection: drawn on the top layer so they never redraw the dots.
@MainActor
final class StatOverlay: ObservableObject {
    @Published var hover: Int?
    @Published var hoverPos = CGPoint.zero
    @Published var focus: Int?
    @Published var band: (a: CGPoint, b: CGPoint)?
    @Published var selected: Set<String> = []
}

@MainActor
final class StatChartModel: ObservableObject {
    private static let margin = (l: 56.0, r: 16.0, t: 84.0, b: 44.0)
    static let dotRadius = 5.0
    static let hitRadius = 9.0
    private static let dragPx = 4.0

    @Published private(set) var points: [StatPoint] = []
    @Published private(set) var hidden: Set<String> = []
    @Published private(set) var familyPalette = false
    @Published private(set) var view = (x: StatRange(lo: 2000, hi: 2010), y: StatData.bpmDefault)
    @Published private(set) var zoomed = false
    @Published private(set) var size = CGSize(width: 1, height: 1)
    @Published private(set) var insetTop = 0.0

    let overlay = StatOverlay()
    var onOpen: ((StatPoint) -> Void)?
    var onFocus: ((StatPoint) -> Void)?

    private var full = (x: StatRange(lo: 2000, hi: 2010), y: StatData.bpmDefault)
    private var items: [StatItem] = []
    private var index = StatIndex([])
    private var stale = true
    private var drag: (start: CGPoint, last: CGPoint, pan: Bool, moved: Bool)?

    struct Plot {
        var x0: Double
        var x1: Double
        var y0: Double
        var y1: Double
    }

    var plot: Plot {
        let y0 = max(Self.margin.t, insetTop)
        return Plot(x0: Self.margin.l, x1: max(Self.margin.l + 1, size.width - Self.margin.r),
                    y0: y0, y1: max(y0 + 1, size.height - Self.margin.b))
    }

    var scales: (x: StatScale, y: StatScale, plot: Plot) {
        let p = plot
        return (StatScale(lo: view.x.lo, hi: view.x.hi, p0: p.x0, p1: p.x1),
                StatScale(lo: view.y.lo, hi: view.y.hi, p0: p.y1, p1: p.y0), p)
    }

    func isVisible(_ it: StatItem) -> Bool { !hidden.contains(it.group) }

    func layoutItems() -> [StatItem] {
        if stale {
            let s = scales
            items = points.map { StatItem(id: $0.id, px: s.x.to($0.x), py: s.y.to($0.y), group: $0.group) }
            index = StatIndex(items)
            stale = false
        }
        return items
    }

    func setSize(_ s: CGSize) {
        guard s.width > 0, s.height > 0, s != size else { return }
        size = s
        stale = true
    }

    func setInsetTop(_ v: Double) {
        guard v != insetTop else { return }
        insetTop = v
        stale = true
    }

    func setFamilyPalette(_ on: Bool) { familyPalette = on }

    func setHidden(_ h: Set<String>) {
        hidden = h
        overlay.hover = nil
    }

    func setData(_ next: [StatPoint], hidden h: Set<String>, familyPalette fam: Bool) {
        points = next
        hidden = h
        familyPalette = fam
        full = (StatData.extentX(next.map(\.year)), StatData.extentY(next.map(\.bpm)))
        if !zoomed { view = full }
        let ids = Set(next.map(\.id))
        overlay.selected = overlay.selected.filter { ids.contains($0) }
        overlay.hover = nil
        overlay.focus = nil
        stale = true
    }

    func recolor(_ next: [StatPoint], hidden h: Set<String>, familyPalette fam: Bool) {
        points = next
        hidden = h
        familyPalette = fam
        stale = true
    }

    private func setView(_ v: (x: StatRange, y: StatRange)) {
        view = v
        zoomed = true
        overlay.hover = nil
        stale = true
    }

    func reset() {
        view = full
        zoomed = false
        overlay.hover = nil
        stale = true
    }

    func center() {
        let x = StatData.center(view.x, on: full.x)
        let y = StatData.clampLo(StatData.center(view.y, on: full.y))
        if abs(x.lo - view.x.lo) < 1e-9 && abs(y.lo - view.y.lo) < 1e-9 { return }
        setView((x, y))
    }

    func select(_ ids: [String]) { overlay.selected = Set(ids) }

    func clearSelection() { overlay.selected = [] }

    func zoom(at pos: CGPoint, factor: Double) {
        let s = scales
        if pos.x < s.plot.x0 - 40 || pos.y > s.plot.y1 + 40 { return }
        let xr = StatData.zoom(view.x, anchor: s.x.from(pos.x), factor: factor, minSpan: StatData.minZoomYears, maxSpan: full.x.span * 3)
        let yr = StatData.zoom(view.y, anchor: s.y.from(pos.y), factor: factor, minSpan: StatData.minZoomBPM, maxSpan: full.y.span * 3)
        setView((xr, StatData.clampLo(yr)))
    }

    func hit(_ pos: CGPoint) -> Int? {
        _ = layoutItems()
        return index.near(x: pos.x, y: pos.y, r: Self.hitRadius, ok: isVisible)
    }

    func pointerDown(_ pos: CGPoint, pan: Bool) {
        drag = (pos, pos, pan, false)
    }

    func pointerDragged(_ pos: CGPoint) {
        guard var d = drag else { return }
        if !d.moved && hypot(pos.x - d.start.x, pos.y - d.start.y) < Self.dragPx { return }
        d.moved = true
        if d.pan {
            let s = scales
            let dx = s.x.from(d.last.x) - s.x.from(pos.x)
            let dy = s.y.from(d.last.y) - s.y.from(pos.y)
            setView((StatData.pan(view.x, delta: dx, bounds: full.x), StatData.clampLo(StatData.pan(view.y, delta: dy, bounds: full.y))))
        } else {
            overlay.band = (d.start, pos)
        }
        d.last = pos
        drag = d
    }

    var isPanning: Bool { drag?.pan == true && drag?.moved == true }

    func pointerUp(_ pos: CGPoint) {
        guard let d = drag else { return }
        drag = nil
        if d.pan { return }
        if overlay.band != nil && d.moved {
            let its = layoutItems()
            let hits = StatNav.inRect(its, d.start, pos, ok: isVisible)
            overlay.band = nil
            select(hits.map { its[$0].id })
        } else {
            overlay.band = nil
            if let i = hit(pos) {
                overlay.focus = i
                onOpen?(points[i])
            } else {
                clearSelection()
            }
        }
    }

    func cancelDrag() {
        drag = nil
        overlay.band = nil
    }

    func hover(_ pos: CGPoint) {
        guard drag == nil else { return }
        let i = hit(pos)
        if i != overlay.hover { overlay.hover = i }
        overlay.hoverPos = pos
    }

    func key(code: UInt16, chars: String) -> Bool {
        switch code {
        case 36, 76:
            if let f = overlay.focus, points.indices.contains(f) { onOpen?(points[f]); return true }
            return false
        case 53:
            clearSelection()
            return true
        case 123, 124, 125, 126:
            let dir: (Double, Double)
            switch code {
            case 123: dir = (-1, 0)
            case 124: dir = (1, 0)
            case 125: dir = (0, 1)
            default: dir = (0, -1)
            }
            let its = layoutItems()
            let next = overlay.focus.map { StatNav.neighbour(its, from: $0, dir: dir, ok: isVisible) } ?? StatNav.first(its, ok: isVisible)
            focus(next)
            return true
        default:
            if chars == "0" { reset(); return true }
            if chars.lowercased() == "c" { center(); return true }
            return false
        }
    }

    func focus(_ i: Int) {
        guard points.indices.contains(i) else { return }
        overlay.focus = i
        onFocus?(points[i])
    }
}

private extension GraphicsContext {
    mutating func ring(_ c: CGPoint, _ r: Double, _ color: Color, _ width: Double, dash: [CGFloat] = []) {
        let path = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
        stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, dash: dash))
    }
}

struct StatBaseLayer: View {
    @ObservedObject var model: StatChartModel

    var body: some View {
        Canvas { ctx, _ in draw(&ctx) }
    }

    private func draw(_ ctx: inout GraphicsContext) {
        let s = model.scales
        let p = s.plot
        let items = model.layoutItems()
        let font = DS.Font.caption
        let xs = StatData.ticks(lo: model.view.x.lo, hi: model.view.x.hi,
                                step: StatData.tickStep(span: model.view.x.span, maxTicks: (p.x1 - p.x0) / 56))
        for v in xs {
            let x = s.x.to(Double(v)).rounded() + 0.5
            var line = Path()
            line.move(to: CGPoint(x: x, y: p.y0)); line.addLine(to: CGPoint(x: x, y: p.y1))
            ctx.stroke(line, with: .color(DS.Color.line), lineWidth: 1)
            ctx.draw(Text(String(v)).font(font).foregroundStyle(DS.Color.inkMuted), at: CGPoint(x: x, y: p.y1 + 6), anchor: .top)
        }
        let ys = StatData.ticks(lo: model.view.y.lo, hi: model.view.y.hi,
                                step: StatData.tickStep(span: model.view.y.span, maxTicks: (p.y1 - p.y0) / 34))
        for v in ys {
            let y = s.y.to(Double(v)).rounded() + 0.5
            var line = Path()
            line.move(to: CGPoint(x: p.x0, y: y)); line.addLine(to: CGPoint(x: p.x1, y: y))
            ctx.stroke(line, with: .color(DS.Color.line), lineWidth: 1)
            ctx.draw(Text(String(v)).font(font).foregroundStyle(DS.Color.inkMuted), at: CGPoint(x: p.x0 - 8, y: y), anchor: .trailing)
        }
        ctx.draw(Text("Year").font(font).foregroundStyle(DS.Color.inkMuted), at: CGPoint(x: (p.x0 + p.x1) / 2, y: model.size.height - 8), anchor: .bottom)
        var rotated = ctx
        rotated.translateBy(x: 14, y: (p.y0 + p.y1) / 2)
        rotated.rotate(by: .degrees(-90))
        rotated.draw(Text("BPM").font(font).foregroundStyle(DS.Color.inkMuted), at: .zero, anchor: .center)

        var dots = ctx
        dots.clip(to: Path(CGRect(x: p.x0, y: p.y0, width: p.x1 - p.x0, height: p.y1 - p.y0)))
        let r = StatChartModel.dotRadius
        let pts = model.points
        let order = items.indices.filter { model.isVisible(items[$0]) }.sorted { pts[$0].color < pts[$1].color }
        var current = Int.min
        var fill = Color.clear
        for i in order {
            let it = items[i]
            if it.px < p.x0 - r || it.px > p.x1 + r || it.py < p.y0 - r || it.py > p.y1 + r { continue }
            if pts[i].color != current {
                current = pts[i].color
                fill = StatPalette.color(current, family: model.familyPalette).opacity(0.55)
            }
            dots.fill(Path(ellipseIn: CGRect(x: it.px - r, y: it.py - r, width: 2 * r, height: 2 * r)), with: .color(fill))
        }
    }
}

struct StatTopLayer: View {
    @ObservedObject var model: StatChartModel
    @ObservedObject var overlay: StatOverlay

    var body: some View {
        Canvas { ctx, _ in draw(&ctx) }
            .allowsHitTesting(false)
    }

    private func draw(_ ctx: inout GraphicsContext) {
        let items = model.layoutItems()
        let r = StatChartModel.dotRadius
        func at(_ i: Int) -> CGPoint { CGPoint(x: items[i].px, y: items[i].py) }
        for i in items.indices where overlay.selected.contains(items[i].id) && model.isVisible(items[i]) {
            ctx.ring(at(i), r + 2, DS.Color.accent, 2)
        }
        if let h = overlay.hover, items.indices.contains(h) {
            let c = at(h)
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r - 1, y: c.y - r - 1, width: 2 * r + 2, height: 2 * r + 2)), with: .color(DS.Color.ink.opacity(0.9)))
            ctx.ring(c, r + 4, DS.Color.ink, 1.5)
        }
        if let f = overlay.focus, items.indices.contains(f) {
            ctx.ring(at(f), r + 6, DS.Color.ink, 2, dash: [3, 3])
        }
        if let b = overlay.band {
            let rect = CGRect(x: min(b.a.x, b.b.x), y: min(b.a.y, b.b.y), width: abs(b.b.x - b.a.x), height: abs(b.b.y - b.a.y))
            ctx.fill(Path(rect), with: .color(DS.Color.accent.opacity(0.15)))
            ctx.stroke(Path(rect), with: .color(DS.Color.accent), lineWidth: 1)
        }
    }
}

struct StatInput: NSViewRepresentable {
    let model: StatChartModel
    let label: String

    func makeNSView(context _: Context) -> StatInputView {
        let v = StatInputView()
        v.model = model
        v.setAccessibilityRole(.image)
        return v
    }

    func updateNSView(_ v: StatInputView, context _: Context) {
        v.model = model
        v.setAccessibilityLabel(label)
    }
}

final class StatInputView: NSView {
    weak var model: StatChartModel?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override var focusRingType: NSFocusRingType {
        get { .none }
        set {
            // The focus ring stays off.
        }
    }

    private var tracking: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(t)
        tracking = t
    }

    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }

    private func pos(_ e: NSEvent) -> CGPoint { convert(e.locationInWindow, from: nil) }

    private func run(_ body: @MainActor (StatChartModel) -> Void) {
        guard let model else { return }
        MainActor.assumeIsolated { body(model) }
    }

    private func cursor() {
        run { m in
            if m.isPanning { NSCursor.closedHand.set() }
            else if m.overlay.hover != nil { NSCursor.pointingHand.set() }
            else { NSCursor.crosshair.set() }
        }
    }

    override func mouseDown(with e: NSEvent) {
        window?.makeFirstResponder(self)
        if e.clickCount == 2 { run { $0.reset() }; return }
        let p = pos(e)
        run { $0.pointerDown(p, pan: e.modifierFlags.contains(.shift)) }
    }

    private func panDown(_ e: NSEvent) { window?.makeFirstResponder(self); let p = pos(e); run { $0.pointerDown(p, pan: true) } }
    private func dragged(_ e: NSEvent) { let p = pos(e); run { $0.pointerDragged(p) }; cursor() }
    private func released(_ e: NSEvent) { let p = pos(e); run { $0.pointerUp(p) }; cursor() }

    override func mouseDragged(with e: NSEvent) { dragged(e) }
    override func mouseUp(with e: NSEvent) { released(e) }
    override func rightMouseDown(with e: NSEvent) { panDown(e) }
    override func rightMouseDragged(with e: NSEvent) { dragged(e) }
    override func rightMouseUp(with e: NSEvent) { released(e) }
    override func otherMouseDown(with e: NSEvent) { panDown(e) }
    override func otherMouseDragged(with e: NSEvent) { dragged(e) }
    override func otherMouseUp(with e: NSEvent) { released(e) }
    override func mouseMoved(with e: NSEvent) { let p = pos(e); run { $0.hover(p) }; cursor() }
    override func mouseExited(with _: NSEvent) { run { if $0.overlay.hover != nil { $0.overlay.hover = nil } } }

    override func scrollWheel(with e: NSEvent) {
        let dy = -e.scrollingDeltaY * (e.hasPreciseScrollingDeltas ? 1 : 10)
        guard dy != 0 else { return }
        let p = pos(e)
        run { $0.zoom(at: p, factor: exp(dy * 0.003)) }
    }

    override func magnify(with e: NSEvent) {
        let p = pos(e)
        run { $0.zoom(at: p, factor: max(0.2, 1 - e.magnification)) }
    }

    override func keyDown(with e: NSEvent) {
        var handled = false
        run { handled = $0.key(code: e.keyCode, chars: e.charactersIgnoringModifiers ?? "") }
        if !handled { super.keyDown(with: e) }
    }
}
