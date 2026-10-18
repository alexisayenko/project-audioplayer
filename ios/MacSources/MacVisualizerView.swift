import SwiftUI

/// Eases the raw bands toward their targets: quick attack, slow release, and decay to zero when no fresh levels arrive.
final class VizSmoother {
    private(set) var bands = [Float](repeating: 0, count: vizBandCount)
    private(set) var bass: Float = 0
    private var last: CFAbsoluteTime = 0

    func step(target: [Float]?, now: CFAbsoluteTime) {
        let dt = Float(min(max(now - last, 0), 0.1))
        last = now
        for i in 0..<vizBandCount {
            let t = target?[i] ?? 0
            let rate: Float = t > bands[i] ? 0.04 : 0.2
            bands[i] += (t - bands[i]) * (1 - expf(-dt / rate))
        }
        let low = bands[0..<6].reduce(0, +) / 6
        bass += (low - bass) * (1 - expf(-dt / 0.25))
    }

    var idle: Bool { bands.allSatisfy { $0 < 0.01 } }

    func level(at position: Double) -> Float {
        let p = min(max(position, 0), 1) * Double(vizBandCount - 1)
        let a = Int(p)
        let b = min(a + 1, vizBandCount - 1)
        let f = Float(p - Double(a))
        return bands[a] * (1 - f) + bands[b] * f
    }
}

struct MacVisualizerView: View {
    @EnvironmentObject var player: PlayerService
    @ObservedObject private var viz = MacVisualizer.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var smoother = VizSmoother()
    @State private var controlsShown = true
    @State private var hideTask: Task<Void, Never>?

    private var stops: [Color] { [DS.Chart.chart11, DS.Chart.chart2, DS.Chart.chart1, DS.Chart.chart5] }

    var body: some View {
        ZStack {
            DS.Color.vinyl
            RadialGradient(colors: [DS.Chart.chart3.opacity(0.35), .clear], center: .center, startRadius: 0, endRadius: 700)
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
                canvas(now: timeline.date.timeIntervalSinceReferenceDate)
            }
            .contentShape(Rectangle())
            .onTapGesture { player.toggle() }
            .accessibilityLabel("Visualizer, \(viz.mode.label)")
            .accessibilityAddTraits(.isImage)
            VStack {
                if controlsShown { top.transition(.opacity) }
                Spacer()
                if let line = statusLine { Text(line).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).padding(.bottom, DS.Space.space2) }
                if controlsShown { bottom.transition(.opacity) }
            }
            .padding(DS.Space.space6)
        }
        .environment(\.colorScheme, .dark)
        .onContinuousHover { _ in poke() }
        .onAppear { poke() }
        .onChange(of: player.current?.id) { _, id in if id == nil { viz.isOpen = false } }
        .animation(.easeOut(duration: reduceMotion ? 0 : 0.2), value: controlsShown)
    }

    private var statusLine: String? {
        switch viz.status {
        case .pending: return player.isPlaying ? "Waiting for audio levels..." : nil
        case .unavailable(let why): return why
        default: return reduceMotion ? "Reduced motion: static frame" : nil
        }
    }

    private var top: some View {
        HStack(alignment: .top, spacing: DS.Space.space3) {
            if let t = player.current {
                VStack(alignment: .leading, spacing: 2) {
                    SongName.title(t).font(DS.Font.title).foregroundStyle(DS.Color.ink).lineLimit(1)
                    Text(SongName.artistLine(t)).font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                }
            }
            Spacer()
            ForEach(VizMode.allCases) { m in
                Button { viz.mode = m } label: { Image(systemName: m.symbol) }
                    .buttonStyle(MacKeyStyle(kind: .toggle(viz.mode == m)))
                    .help(m.label + (m == viz.mode ? "" : " (M)"))
                    .accessibilityLabel(m.label)
                    .accessibilityValue(viz.mode == m ? "selected" : "")
            }
            Button { viz.isOpen = false } label: { Image(systemName: "xmark") }
                .buttonStyle(MacKeyStyle()).help("Exit visualizer (Esc)").accessibilityLabel("Exit visualizer")
        }
    }

    private var bottom: some View {
        HStack(spacing: DS.Space.space3) {
            Button { player.previous() } label: { Image(systemName: "backward.end.fill") }
                .buttonStyle(MacKeyStyle()).help("Previous").accessibilityLabel("Previous song")
            Button { player.toggle() } label: { Image(systemName: player.isPlaying ? "pause.fill" : "play.fill") }
                .buttonStyle(MacKeyStyle(kind: .lit)).help(player.isPlaying ? "Pause" : "Play")
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            Button { player.next() } label: { Image(systemName: "forward.end.fill") }
                .buttonStyle(MacKeyStyle()).disabled(!player.hasNext).help("Next").accessibilityLabel("Next song")
            Text("\(macTime(player.position)) / \(macTime(player.duration))")
                .font(DS.Font.time).foregroundStyle(DS.Color.inkMuted).fixedSize()
            MacScrubber(value: player.position, range: 0...max(player.duration, 1), label: "Position",
                        disabled: player.duration <= 0, bubble: macTime, keyStep: 5,
                        onCommit: { player.seek(to: $0) })
        }
        .frame(maxWidth: 720)
    }

    private func poke() {
        controlsShown = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, player.isPlaying else { return }
            controlsShown = false
        }
    }

    private func canvas(now: CFAbsoluteTime) -> some View {
        let snap = viz.levels.snapshot()
        let fresh = player.isPlaying && !reduceMotion && snap.age < 0.3
        smoother.step(target: fresh ? snap.bands : nil, now: now)
        let mode = viz.mode
        let colors = stops
        let line = DS.Color.accent
        let s = smoother
        return Canvas { ctx, size in
            switch mode {
            case .bars: Self.drawBars(&ctx, size, s, colors, line)
            case .ring: Self.drawRing(&ctx, size, s, colors)
            }
        }
    }

    private static func drawBars(_ ctx: inout GraphicsContext, _ size: CGSize, _ s: VizSmoother, _ colors: [Color], _ line: Color) {
        let w = size.width
        let h = size.height
        let total = min(max(Int((w / 4).rounded()), 96), 480) / 2 * 2
        let half = total / 2
        let pitch = w / CGFloat(total)
        let barW = max(pitch * 0.6, 1.5)
        let horizon = (h * 0.58).rounded()
        let up = h * 0.4
        let down = h * 0.2
        let gradient = GraphicsContext.Shading.linearGradient(
            Gradient(colors: colors), startPoint: CGPoint(x: 0, y: 0), endPoint: CGPoint(x: w, y: 0))
        if !s.idle {
            var above = Path()
            var below = Path()
            for i in 0..<half {
                let lv = CGFloat(s.level(at: Double(i) / Double(max(half - 1, 1))))
                let bh = pow(lv, 1.2) * up
                guard bh >= 1 else { continue }
                for x in [CGFloat(half - 1 - i) * pitch, CGFloat(half + i) * pitch] {
                    above.addRect(CGRect(x: x + (pitch - barW) / 2, y: horizon - bh, width: barW, height: bh))
                    below.addRect(CGRect(x: x + (pitch - barW) / 2, y: horizon + 2, width: barW, height: min(bh * 0.5, down)))
                }
            }
            ctx.drawLayer { l in
                l.addFilter(.blur(radius: 10))
                l.opacity = 0.7
                l.fill(above, with: gradient)
            }
            ctx.fill(above, with: gradient)
            ctx.opacity = 0.35
            ctx.fill(below, with: gradient)
            ctx.opacity = 1
        }
        var rule = Path()
        rule.addRect(CGRect(x: 0, y: horizon - 0.75, width: w, height: 1.5))
        ctx.fill(rule, with: .linearGradient(
            Gradient(colors: [line.opacity(0.1), line, line.opacity(0.1)]),
            startPoint: CGPoint(x: 0, y: 0), endPoint: CGPoint(x: w, y: 0)))
    }

    private static func drawRing(_ ctx: inout GraphicsContext, _ size: CGSize, _ s: VizSmoother, _ colors: [Color]) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let base = min(size.width, size.height) * 0.22
        let radius = base * (1 + 0.1 * CGFloat(s.bass))
        let sweep = colors + colors.dropLast().reversed()
        let shading = GraphicsContext.Shading.conicGradient(Gradient(colors: sweep), center: center, angle: .degrees(-90))
        var circle = Path()
        circle.addEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
        var spokes = Path()
        let count = 128
        if !s.idle {
            for i in 0..<count {
                let u = Double(i) / Double(count)
                let m = u < 0.5 ? u * 2 : (1 - u) * 2
                let lv = CGFloat(s.level(at: m))
                guard lv > 0.02 else { continue }
                let a = u * 2 * .pi - .pi / 2
                let r0 = radius + 6
                let r1 = r0 + pow(lv, 1.2) * base * 1.1
                spokes.move(to: CGPoint(x: center.x + CGFloat(cos(a)) * r0, y: center.y + CGFloat(sin(a)) * r0))
                spokes.addLine(to: CGPoint(x: center.x + CGFloat(cos(a)) * r1, y: center.y + CGFloat(sin(a)) * r1))
            }
        }
        let spokeStyle = StrokeStyle(lineWidth: 3, lineCap: .round)
        ctx.drawLayer { l in
            l.addFilter(.blur(radius: 10))
            l.opacity = 0.7
            l.stroke(circle, with: shading, lineWidth: 4)
            l.stroke(spokes, with: shading, style: spokeStyle)
        }
        ctx.stroke(circle, with: shading, lineWidth: 3)
        ctx.stroke(spokes, with: shading, style: spokeStyle)
    }
}
