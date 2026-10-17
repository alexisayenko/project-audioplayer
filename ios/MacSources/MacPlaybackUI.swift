import SwiftUI

struct PlaybackCover: View {
    let source: String?
    var radius: CGFloat = DS.Radius.radiusCard
    @EnvironmentObject var settings: Settings
    @State private var image: PlatformImage?

    private static let cache = NSCache<NSString, PlatformImage>()

    var body: some View {
        GeometryReader { g in
            ZStack {
                if let image {
                    Image(platformImage: image).resizable().scaledToFill().frame(width: g.size.width, height: g.size.height).clipped()
                } else {
                    DS.Color.vinyl
                    Circle().fill(DS.Color.accent).frame(width: g.size.width * 0.4, height: g.size.width * 0.4)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(DS.Color.copper, lineWidth: DS.Stroke.strokeHairline))
        .task(id: source) { await load() }
        .accessibilityHidden(true)
    }

    private func load() async {
        guard let source, !source.isEmpty else { image = nil; return }
        if let hit = Self.cache.object(forKey: source as NSString) { image = hit; return }
        let data: Data?
        if source.hasPrefix("/") {
            data = try? await APIClient(baseURL: settings.serverURL, token: settings.token).fetch(source)
        } else if let url = URL(string: source), url.scheme == "https" || url.scheme == "http" {
            data = try? await URLSession.shared.data(from: url).0
        } else {
            data = nil
        }
        guard !Task.isCancelled else { return }
        guard let data, let img = PlatformImage(data: data) else { image = nil; return }
        Self.cache.setObject(img, forKey: source as NSString)
        image = img
    }
}

struct MacKeyStyle: ButtonStyle {
    enum Kind { case key, lit, toggle(Bool) }
    var kind: Kind = .key
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous)
        let lit: Bool = { if case .lit = kind { return true }; return false }()
        let on: Bool = { if case .toggle(let v) = kind { return v }; return false }()
        return configuration.label
            .font(.system(size: lit ? 17 : 14, weight: .semibold))
            .foregroundStyle(lit ? DS.Color.onAccent : (on ? DS.Color.accentInk : DS.Color.ink))
            .frame(width: lit ? 52 : 36, height: 36)
            .background {
                if lit {
                    shape.fill(DS.Color.accent).shadow(color: DS.Color.accent.opacity(0.5), radius: 8)
                } else if on {
                    shape.strokeBorder(DS.Color.accent, lineWidth: DS.Stroke.strokeHairline)
                        .shadow(color: DS.Color.accent.opacity(0.25), radius: 6)
                } else {
                    shape.fill(DS.Color.surfaceKey).shadow(color: DS.Color.vinyl.opacity(0.2), radius: 2, y: 1)
                }
            }
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .contentShape(shape)
    }
}

struct RoundIconButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(DS.Color.ink)
            .frame(width: DS.Space.hit, height: DS.Space.hit)
            .background(Circle().fill(DS.Color.surfaceKey))
            .overlay(Circle().strokeBorder(DS.Color.line, lineWidth: DS.Stroke.strokeHairline))
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .contentShape(Circle())
    }
}

/// A flat slider: sunken track, accent fill, thumb. A press jumps, a drag continues anywhere, the value is committed once on release.
struct MacScrubber: View {
    let value: Double
    var range: ClosedRange<Double>
    var label: String
    var thumb: CGFloat = 16
    var disabled = false
    var bubble: ((Double) -> String)?
    var keyStep: Double
    var onChange: ((Double) -> Void)?
    var onCommit: (Double) -> Void
    @State private var dragging: Double?
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    private var span: Double { max(range.upperBound - range.lowerBound, 0.0001) }

    var body: some View {
        GeometryReader { g in
            let shown = dragging ?? value
            let frac = min(1, max(0, (shown - range.lowerBound) / span))
            let track = max(g.size.width - thumb, 1)
            let x = track * frac
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken).frame(height: 6)
                Capsule().fill(DS.Color.accent).frame(width: x + thumb / 2, height: 6)
                Circle().fill(scheme == .dark ? DS.Color.ink : DS.Color.surface)
                    .overlay(Circle().strokeBorder(DS.Color.accent, lineWidth: DS.Stroke.strokeHairline))
                    .frame(width: thumb, height: thumb)
                    .shadow(color: DS.Color.vinyl.opacity(0.3), radius: 2, y: 1)
                    .offset(x: x)
                    .overlay(alignment: .top) {
                        if let dragging, let bubble {
                            Text(bubble(dragging)).font(DS.Font.time).foregroundStyle(DS.Color.ink)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(RoundedRectangle(cornerRadius: DS.Radius.radiusXs).fill(DS.Color.surface))
                                .overlay(RoundedRectangle(cornerRadius: DS.Radius.radiusXs).strokeBorder(DS.Color.line))
                                .fixedSize()
                                .offset(x: x, y: -26)
                                .allowsHitTesting(false)
                        }
                    }
            }
            .frame(height: g.size.height)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { d in
                        guard !disabled else { return }
                        let v = pick(d.location.x, track)
                        dragging = v
                        onChange?(v)
                    }
                    .onEnded { d in
                        guard !disabled else { return }
                        let v = pick(d.location.x, track)
                        dragging = nil
                        onCommit(v)
                    }
            )
        }
        .frame(height: 28)
        .opacity(disabled ? 0.45 : 1)
        .focusable(!disabled)
        .focused($focused)
        .overlay {
            if focused && !disabled {
                RoundedRectangle(cornerRadius: DS.Radius.radiusXs).strokeBorder(DS.Color.accent, lineWidth: DS.Stroke.strokeFocus).padding(-2)
            }
        }
        .onKeyPress(phases: [.down, .repeat]) { press in
            guard !disabled else { return .ignored }
            let step = press.modifiers.contains(.shift) ? keyStep * 3 : keyStep
            switch press.key {
            case .leftArrow, .downArrow: move(value - step)
            case .rightArrow, .upArrow: move(value + step)
            case .home: move(range.lowerBound)
            case .end: move(range.upperBound)
            default: return .ignored
            }
            return .handled
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(bubble?(value) ?? "\(Int((value - range.lowerBound) / span * 100)) percent")
        .accessibilityAdjustableAction { dir in
            switch dir {
            case .increment: move(value + keyStep)
            case .decrement: move(value - keyStep)
            @unknown default: break
            }
        }
    }

    private func pick(_ x: CGFloat, _ track: CGFloat) -> Double {
        range.lowerBound + span * min(1, max(0, Double((x - thumb / 2) / track)))
    }

    private func move(_ v: Double) {
        let c = min(range.upperBound, max(range.lowerBound, v))
        onChange?(c)
        onCommit(c)
    }
}

/// Wraps its children onto new lines.
struct PlaybackFlow: Layout {
    var spacing: CGFloat = DS.Space.space2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(subviews, width: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (i, p) in arrange(subviews, width: bounds.width).points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> (points: [CGPoint], size: CGSize) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0, x + sz.width > width { x = 0; y += row + spacing; row = 0 }
            points.append(CGPoint(x: x, y: y))
            x += sz.width + spacing
            row = max(row, sz.height)
            maxX = max(maxX, x - spacing)
        }
        return (points, CGSize(width: maxX, height: y + row))
    }
}
