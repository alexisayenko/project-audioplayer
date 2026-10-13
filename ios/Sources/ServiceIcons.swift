import SwiftUI

enum ServiceKind: CaseIterable {
    case youtube, soundcloud, wikipedia, spotify

    var label: String {
        switch self {
        case .youtube: "YouTube"
        case .soundcloud: "SoundCloud"
        case .wikipedia: "Wikipedia"
        case .spotify: "Spotify"
        }
    }

    var brand: Color {
        switch self {
        case .youtube: DS.Color.brandYoutube
        case .soundcloud: DS.Color.brandSoundcloud
        case .wikipedia: DS.Color.brandWikipedia
        case .spotify: DS.Color.brandSpotify
        }
    }
}

private struct YouTubeShape: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let body = CGRect(x: r.minX, y: r.minY + r.height * 0.18, width: r.width, height: r.height * 0.64)
        p.addRoundedRect(in: body, cornerSize: CGSize(width: r.width * 0.2, height: r.width * 0.2))
        let cx = r.midX, cy = r.midY, w = r.width * 0.12, h = r.height * 0.17
        p.move(to: CGPoint(x: cx - w, y: cy - h))
        p.addLine(to: CGPoint(x: cx + w * 1.4, y: cy))
        p.addLine(to: CGPoint(x: cx - w, y: cy + h))
        p.closeSubpath()
        return p
    }
}

private struct SoundCloudShape: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height
        let base = r.minY + h * 0.78
        p.move(to: CGPoint(x: r.minX + w * 0.12, y: base))
        p.addArc(center: CGPoint(x: r.minX + w * 0.12, y: base - h * 0.14), radius: h * 0.14,
                 startAngle: .degrees(90), endAngle: .degrees(270), clockwise: false)
        p.addArc(center: CGPoint(x: r.minX + w * 0.36, y: base - h * 0.24), radius: h * 0.22,
                 startAngle: .degrees(180), endAngle: .degrees(280), clockwise: false)
        p.addArc(center: CGPoint(x: r.minX + w * 0.62, y: base - h * 0.34), radius: h * 0.32,
                 startAngle: .degrees(200), endAngle: .degrees(330), clockwise: false)
        p.addArc(center: CGPoint(x: r.minX + w * 0.84, y: base - h * 0.16), radius: h * 0.16,
                 startAngle: .degrees(270), endAngle: .degrees(90), clockwise: false)
        p.closeSubpath()
        return p
    }
}

private struct SpotifyShape: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.addEllipse(in: r)
        return p
    }
}

private struct SpotifyArcs: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height
        for (y, half) in [(0.34, 0.30), (0.50, 0.24), (0.65, 0.18)] {
            let cy = r.minY + h * y
            p.move(to: CGPoint(x: r.midX - w * half, y: cy))
            p.addQuadCurve(to: CGPoint(x: r.midX + w * half, y: cy),
                           control: CGPoint(x: r.midX, y: cy - h * 0.12))
        }
        return p
    }
}

struct ServiceIcon: View {
    let kind: ServiceKind
    var active: Bool
    var url: URL?
    var pulsing = false
    var size: CGFloat = 24

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    private var color: Color { active ? kind.brand : DS.Color.inkFaint }

    @ViewBuilder private var glyph: some View {
        switch kind {
        case .youtube:
            YouTubeShape().fill(color, style: FillStyle(eoFill: true))
        case .soundcloud:
            SoundCloudShape().fill(color)
        case .wikipedia:
            Text("W").font(.system(size: size * 0.95, weight: .semibold, design: .serif)).foregroundStyle(color)
                .minimumScaleFactor(0.5)
        case .spotify:
            SpotifyShape().fill(color)
                .overlay(SpotifyArcs().stroke(DS.Color.surface, style: StrokeStyle(lineWidth: size * 0.08, lineCap: .round)).padding(size * 0.1))
        }
    }

    var body: some View {
        let icon = glyph
            .frame(width: size, height: size)
            .opacity(pulsing ? (reduceMotion ? 0.5 : (dim ? 0.35 : 1)) : 1)
            .scaleEffect(pulsing && !reduceMotion && dim ? 0.9 : 1)
            .animation(pulsing && !reduceMotion ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default, value: dim)
            .onChange(of: pulsing) { _, on in dim = on && !reduceMotion }
            .onAppear { dim = pulsing && !reduceMotion }
            .contentShape(Rectangle())
            .frame(minWidth: 32, minHeight: 32)
        if active, let url {
            Link(destination: url) { icon }
                .accessibilityLabel(kind.label).accessibilityAddTraits(.isLink)
        } else {
            icon.accessibilityLabel(kind.label)
        }
    }
}

struct ServiceIconRow: View {
    let busy: Bool
    let found: [ServiceKind: URL?]

    var body: some View {
        HStack(spacing: DS.Space.space1) {
            ForEach(ServiceKind.allCases, id: \.self) { kind in
                let hit = kind != .spotify && found[kind] != nil
                ServiceIcon(kind: kind, active: hit, url: found[kind] ?? nil,
                            pulsing: busy && kind != .spotify)
            }
        }
    }
}
