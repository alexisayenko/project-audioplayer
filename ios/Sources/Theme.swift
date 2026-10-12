import SwiftUI

enum Theme {
    static let panel = Color(red: 0.055, green: 0.055, blue: 0.06)
    static let panelRaised = Color(red: 0.11, green: 0.11, blue: 0.12)
    static let label = Color.white.opacity(0.92)
    static let labelDim = Color.white.opacity(0.58)
    static let cyan = Color(red: 0.16, green: 0.72, blue: 0.95)
    static let red = Color(red: 0.88, green: 0.15, blue: 0.14)
    static let green = Color(red: 0.30, green: 0.85, blue: 0.45)

    static let walnut = LinearGradient(
        colors: [Color(red: 0.62, green: 0.27, blue: 0.09), Color(red: 0.74, green: 0.35, blue: 0.12),
                 Color(red: 0.50, green: 0.20, blue: 0.06)],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    static let chrome = LinearGradient(
        colors: [Color(white: 0.95), Color(white: 0.55), Color(white: 0.85), Color(white: 0.4), Color(white: 0.75)],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    static let chromeEdge = LinearGradient(
        colors: [Color(white: 0.9), Color(white: 0.35)], startPoint: .top, endPoint: .bottom)

    static func caption(_ text: String) -> Text {
        Text(text).font(.caption2.smallCaps().weight(.semibold)).tracking(0.8)
    }
}

extension View {
    func panelLabel() -> some View {
        font(.caption.smallCaps().weight(.semibold)).tracking(0.8).foregroundStyle(Theme.labelDim)
    }

    func panelBackground() -> some View {
        background(Theme.panel.ignoresSafeArea())
    }

    func panelRow() -> some View {
        listRowBackground(Theme.panelRaised)
            .listRowSeparatorTint(Color.white.opacity(0.12))
            .foregroundStyle(Theme.label)
    }

    func woodBar(_ placement: ToolbarPlacement) -> some View {
        toolbarBackground(Theme.walnut, for: placement)
            .toolbarBackground(.visible, for: placement)
            .toolbarColorScheme(.dark, for: placement)
    }
}

struct WoodBackground: View {
    var body: some View {
        ZStack {
            Theme.walnut
            Canvas { ctx, size in
                var seed: UInt64 = 42
                func rnd() -> Double {
                    seed = seed &* 6364136223846793005 &+ 1442695040888963407
                    return Double(seed >> 33) / Double(1 << 31)
                }
                for _ in 0..<70 {
                    let y = rnd() * size.height
                    let amp = rnd() * 6 + 1
                    var p = Path()
                    p.move(to: CGPoint(x: 0, y: y))
                    p.addCurve(to: CGPoint(x: size.width, y: y + (rnd() - 0.5) * 30),
                               control1: CGPoint(x: size.width * 0.3, y: y + amp),
                               control2: CGPoint(x: size.width * 0.7, y: y - amp))
                    ctx.stroke(p, with: .color(.black.opacity(0.05 + rnd() * 0.1)), lineWidth: 0.5 + rnd() * 1.2)
                }
            }
            LinearGradient(colors: [.white.opacity(0.22), .clear, .clear, .white.opacity(0.06)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .ignoresSafeArea()
    }
}

struct LED: View {
    var on: Bool
    var color: Color = Theme.red
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(RadialGradient(colors: on ? [.white.opacity(0.9), color] : [color.opacity(0.35), color.opacity(0.15)],
                                 center: .init(x: 0.4, y: 0.35), startRadius: 0, endRadius: size))
            .frame(width: size, height: size)
            .overlay(Circle().stroke(Theme.chromeEdge, lineWidth: 1))
            .shadow(color: on ? color.opacity(0.9) : .clear, radius: 4)
            .accessibilityHidden(true)
    }
}

struct PianoButtonStyle: ButtonStyle {
    var tint: Color?
    var lit: Bool

    func makeBody(configuration: Configuration) -> some View {
        let base = tint ?? (lit ? Theme.cyan : Color(white: 0.1))
        let fill = lit || tint != nil ? base : Color(white: 0.1)
        configuration.label
            .foregroundStyle(lit && tint == nil ? Color.black : Theme.label)
            .padding(.horizontal, 10).padding(.vertical, 8)
            .frame(minWidth: 44, minHeight: 44)
            .background(
                RoundedRectangle(cornerRadius: 3)
                    .fill(LinearGradient(colors: [fill.opacity(lit || tint != nil ? 1 : 0.9), fill.opacity(0.65)],
                                         startPoint: .top, endPoint: .bottom))
            )
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Theme.chromeEdge, lineWidth: 1.5))
            .shadow(color: lit ? (tint ?? Theme.cyan).opacity(0.7) : .clear, radius: 5)
            .offset(y: configuration.isPressed ? 1.5 : 0)
            .brightness(configuration.isPressed ? -0.1 : 0)
    }
}

/// Rectangular piano-style key. `lit` glows cyan (or `tint` when given, e.g. the red power key).
struct PianoButton<Label: View>: View {
    var lit = false
    var tint: Color?
    let action: () -> Void
    @ViewBuilder let label: () -> Label

    var body: some View {
        Button(action: action) {
            label().font(.body.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .buttonStyle(PianoButtonStyle(tint: tint, lit: lit))
    }
}

struct RotaryKnob: View {
    @Binding var value: Double
    var title: String
    var cyrillic: String
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 72
    @State private var dragStart: Double?

    private var angle: Double { -135 + value * 270 }

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Canvas { ctx, sz in
                    let c = CGPoint(x: sz.width / 2, y: sz.height / 2)
                    for i in 0...10 {
                        let a = Angle.degrees(-225 + Double(i) * 27).radians
                        let major = i == 0 || i == 10
                        var p = Path()
                        p.move(to: CGPoint(x: c.x + cos(a) * sz.width * 0.42, y: c.y + sin(a) * sz.width * 0.42))
                        p.addLine(to: CGPoint(x: c.x + cos(a) * sz.width * (major ? 0.5 : 0.46),
                                              y: c.y + sin(a) * sz.width * (major ? 0.5 : 0.46)))
                        ctx.stroke(p, with: .color(.white.opacity(major ? 0.9 : 0.5)), lineWidth: major ? 2 : 1)
                    }
                }
                Group {
                    Circle().fill(Theme.chrome)
                    Canvas { ctx, sz in
                        let c = CGPoint(x: sz.width / 2, y: sz.height / 2)
                        for i in 0..<40 {
                            let a = Double(i) / 40 * 2 * .pi
                            var p = Path()
                            p.move(to: CGPoint(x: c.x + cos(a) * sz.width * 0.40, y: c.y + sin(a) * sz.width * 0.40))
                            p.addLine(to: CGPoint(x: c.x + cos(a) * sz.width * 0.5, y: c.y + sin(a) * sz.width * 0.5))
                            ctx.stroke(p, with: .color(.black.opacity(0.45)), lineWidth: 1.2)
                        }
                    }
                    Circle().fill(RadialGradient(colors: [Color(white: 0.2), .black], center: .center,
                                                 startRadius: 0, endRadius: size * 0.3))
                        .padding(size * 0.15)
                    Capsule().fill(.white).frame(width: 3, height: size * 0.2)
                        .offset(y: -size * 0.2)
                }
                .frame(width: size * 0.78, height: size * 0.78)
                .rotationEffect(.degrees(angle))
            }
            .frame(width: size, height: size)
            .contentShape(Circle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                if dragStart == nil { dragStart = value }
                value = min(1, max(0, (dragStart ?? value) - Double(g.translation.height) / 160))
            }.onEnded { _ in dragStart = nil })
            HStack {
                Text("min"); Spacer(minLength: 0); Text("max")
            }
            .font(.system(size: 9, design: .rounded)).foregroundStyle(Theme.labelDim)
            .frame(width: size)
            Theme.caption(title).foregroundStyle(Theme.label)
            Text(cyrillic).font(.system(size: 9, weight: .semibold, design: .rounded)).foregroundStyle(Theme.labelDim)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue("\(Int(value * 100)) percent")
        .accessibilityAdjustableAction { dir in
            switch dir {
            case .increment: value = min(1, value + 0.1)
            case .decrement: value = max(0, value - 0.1)
            @unknown default: break
            }
        }
    }
}
