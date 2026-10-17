import AppKit
import SwiftUI

private final class GenPointerBox {
    var point: CGPoint?
}

/// The force graph: Canvas drawing plus drag, pan, click, double click, pinch, wheel zoom, hover and keys.
struct GenCanvasView: View {
    let engine: GenEngine
    @ObservedObject var frame: GenFrameState
    let escape: () -> Void
    @FocusState private var focused: Bool
    @State private var lastMagnification = 1.0
    @State private var pointer = GenPointerBox()
    @State private var monitor: Any?

    var body: some View {
        let _ = frame.redraw
        TimelineView(.animation(minimumInterval: nil, paused: engine.reduced)) { _ in
            Canvas(rendersAsynchronously: false) { ctx, size in
                if engine.size != size { engine.resize(size) }
                engine.step()
                engine.draw(ctx, size: size)
            }
        }
        .background(DS.Color.surface)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { v in
                    if !engine.isDragging {
                        focused = true
                        engine.beginDrag(v.startLocation.x, v.startLocation.y)
                    }
                    engine.moveDrag(v.location.x, v.location.y)
                }
                .onEnded { v in
                    engine.moveDrag(v.location.x, v.location.y)
                    engine.endDrag()
                })
        .simultaneousGesture(
            MagnifyGesture()
                .onChanged { v in
                    engine.zoomAt(v.magnification / lastMagnification, v.startLocation.x, v.startLocation.y)
                    lastMagnification = v.magnification
                }
                .onEnded { _ in lastMagnification = 1 })
        .onContinuousHover { phase in
            switch phase {
            case .active(let p):
                pointer.point = p
                if !engine.isDragging {
                    engine.hover(at: p)
                    (engine.hoveredID != nil ? NSCursor.pointingHand : NSCursor.openHand).set()
                }
            case .ended:
                pointer.point = nil
                engine.hover(at: nil)
                NSCursor.arrow.set()
            }
        }
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(phases: [.down, .repeat]) { press in key(press) }
        .overlay(alignment: .topLeading) {
            if let tip = frame.tip {
                Text(tip.text).font(T.caption).foregroundStyle(DS.Color.surface).lineLimit(1)
                    .padding(.horizontal, DS.Space.space2).padding(.vertical, DS.Space.space1)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(DS.Color.ink))
                    .offset(x: tip.x, y: tip.y)
                    .allowsHitTesting(false)
            }
        }
        .clipped()
        .onAppear { install() }
        .onDisappear { remove() }
        .accessibilityElement()
        .accessibilityLabel("Genre graph. Drag to move genres, scroll or pinch to zoom, click a genre to select it. The outline lists the same genres. Keys: plus, minus, arrows, 0 to fit.")
    }

    private func key(_ press: KeyPress) -> KeyPress.Result {
        switch press.key {
        case .leftArrow: engine.pan(dx: 40, dy: 0)
        case .rightArrow: engine.pan(dx: -40, dy: 0)
        case .upArrow: engine.pan(dx: 0, dy: 40)
        case .downArrow: engine.pan(dx: 0, dy: -40)
        case .escape: escape()
        default:
            switch press.characters {
            case "+", "=": engine.zoom(1.25)
            case "-": engine.zoom(0.8)
            case "0": engine.fit()
            default: return .ignored
            }
        }
        return .handled
    }

    private func install() {
        guard monitor == nil else { return }
        let box = pointer
        monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { ev in
            guard let p = box.point else { return ev }
            let dy = Double(ev.scrollingDeltaY)
            if dy == 0 { return nil }
            let rate = ev.hasPreciseScrollingDeltas ? 0.0015 : 0.05
            MainActor.assumeIsolated { engine.zoomAt(exp(dy * rate), p.x, p.y) }
            return nil
        }
    }

    private func remove() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}
