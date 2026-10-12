import SwiftUI

/// The Playback deck: a surface frame with a copper rim, the platter, a tonearm that follows progress and a red LED.
/// Drawn from tokens only; it renders the same in both themes.
struct Deck: View {
    @EnvironmentObject var player: PlayerService
    @State private var base = 0.0
    @State private var started: Date?
    private let rpm = 33.3 * 360 / 60

    private func angle(at date: Date) -> Double {
        base + (started.map { date.timeIntervalSince($0) } ?? 0) * rpm
    }

    var body: some View {
        let progress = min(1, player.position / max(player.duration, 1))
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let d = h * 0.83
            let center = CGPoint(x: h * 0.1 + d / 2 + w * 0.02, y: h / 2)
            let pivot = CGPoint(x: w - h * 0.165, y: h * 0.12)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous).fill(DS.Color.surface)
                RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous)
                    .strokeBorder(DS.Color.copper, lineWidth: 3)
                RoundedRectangle(cornerRadius: DS.Radius.radiusCard - 3, style: .continuous)
                    .strokeBorder(DS.Color.copperDeep, lineWidth: 2).padding(3)
                TimelineView(.animation(paused: started == nil)) { ctx in
                    Platter(art: player.current?.thumbnail).frame(width: d, height: d)
                        .rotationEffect(.degrees(angle(at: ctx.date)))
                }
                .frame(width: d, height: d)
                .position(center)
                Tonearm(pivot: pivot, scale: h / 236, armAngle: armAngle(progress: progress, pivot: pivot, center: center, radius: d / 2))
                Circle().fill(DS.Color.power).frame(width: 6, height: 6)
                    .shadow(color: DS.Color.power.opacity(player.isPlaying ? 0.9 : 0), radius: 4)
                    .position(x: w - h * 0.095, y: h - h * 0.095)
            }
        }
        .aspectRatio(358.0 / 236.0, contentMode: .fit)
        .onAppear { if player.isPlaying { started = Date() } }
        .onChange(of: player.isPlaying) { _, playing in
            if playing { started = Date() }
            else { base = angle(at: Date()).truncatingRemainder(dividingBy: 360); started = nil }
        }
        .accessibilityHidden(true)
    }

    /// Parked when paused; while playing the stylus walks from the rim toward the label as the song progresses.
    private func armAngle(progress: Double, pivot: CGPoint, center: CGPoint, radius: CGFloat) -> Double {
        guard player.isPlaying else { return 4 }
        let length = hypot(pivot.x - center.x, pivot.y - center.y) * 0.98
        let target = radius * (0.93 - 0.55 * progress)
        var best = 4.0, bestErr = CGFloat.infinity
        var a = 4.0
        while a <= 70 {
            let r = a * .pi / 180
            let tip = CGPoint(x: pivot.x - length * sin(r), y: pivot.y + length * cos(r))
            let err = abs(hypot(tip.x - center.x, tip.y - center.y) - target)
            if err < bestErr { bestErr = err; best = a }
            a += 0.25
        }
        return best
    }
}

private struct Tonearm: View {
    let pivot: CGPoint
    let scale: CGFloat
    let armAngle: Double

    var body: some View {
        let length = scale * 150
        ZStack(alignment: .topLeading) {
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 3 * scale).fill(DS.Color.chrome).frame(width: 6 * scale, height: length)
                RoundedRectangle(cornerRadius: 4 * scale).fill(DS.Color.inkMuted)
                    .frame(width: 18 * scale, height: 28 * scale).offset(y: length - 12 * scale)
            }
            .frame(width: 18 * scale, height: length + 24 * scale, alignment: .top)
            .rotationEffect(.degrees(armAngle), anchor: .top)
            .position(x: pivot.x, y: pivot.y + (length + 24 * scale) / 2)
            .animation(.easeInOut(duration: 0.9), value: armAngle)
            Circle().fill(DS.Color.chrome).frame(width: 26 * scale, height: 26 * scale)
                .overlay(Circle().strokeBorder(DS.Color.surfaceSunken, lineWidth: 4 * scale))
                .position(pivot)
        }
    }
}

private struct Platter: View {
    let art: String?

    var body: some View {
        GeometryReader { geo in
            let d = geo.size.width
            ZStack {
                Circle().fill(DS.Color.vinyl)
                Circle().strokeBorder(DS.Color.line.opacity(0.35), lineWidth: 1).padding(d * 0.12)
                Circle().strokeBorder(DS.Color.line.opacity(0.25), lineWidth: 1).padding(d * 0.2)
                ZStack {
                    Circle().fill(DS.Color.accent)
                    if let art { CoverImage(source: art).clipShape(Circle()) }
                }
                .frame(width: d * 0.33, height: d * 0.33)
                Circle().fill(DS.Color.surface).frame(width: d * 0.04, height: d * 0.04)
            }
        }
    }
}
