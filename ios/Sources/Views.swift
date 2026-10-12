import SwiftUI

enum AppTab: Hashable { case library, add, playback, settings }

struct RootView: View {
    @EnvironmentObject var player: PlayerService
    @State private var tab = AppTab.library

    var body: some View {
        TabView(selection: $tab) {
            LibraryView().miniPlayerInset(show: true) { tab = .playback }
                .tabItem { Label("Library", systemImage: "music.note.list") }.tag(AppTab.library)
            AddView(openPlayback: { tab = .playback }).miniPlayerInset(show: true) { tab = .playback }
                .tabItem { Label("Add", systemImage: "plus.circle") }.tag(AppTab.add)
            PlaybackView()
                .tabItem { Label("Playback", systemImage: "play.circle") }.tag(AppTab.playback)
                .badge(player.queue.count)
            SettingsView().miniPlayerInset(show: true) { tab = .playback }
                .tabItem { Label("Settings", systemImage: "gear") }.tag(AppTab.settings)
        }
        .tint(Theme.cyan)
        .preferredColorScheme(.dark)
        .toolbarBackground(Theme.panel, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}

private struct MiniPlayerInset: ViewModifier {
    @EnvironmentObject var player: PlayerService
    let show: Bool
    let onTap: () -> Void

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if show, player.current != nil {
                MiniPlayer().onTapGesture(perform: onTap).padding(.bottom, 20)
            }
        }
    }
}

extension View {
    func miniPlayerInset(show: Bool, onTap: @escaping () -> Void) -> some View { modifier(MiniPlayerInset(show: show, onTap: onTap)) }
}

struct TrackRow: View {
    let title: String
    let subtitle: String
    let thumbnail: String?
    var highlighted = false

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(source: thumbnail)
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Theme.chromeEdge, lineWidth: 1))
            VStack(alignment: .leading) {
                Text(title).lineLimit(1).foregroundStyle(highlighted ? Theme.cyan : Theme.label)
                Text(subtitle).font(.caption).foregroundStyle(Theme.labelDim).lineLimit(1)
            }
            if highlighted { Spacer(minLength: 0); LED(on: true, color: Theme.cyan) }
        }
    }
}

func formatTime(_ seconds: Double) -> String {
    let s = Int(max(seconds, 0))
    return String(format: "%d:%02d", s / 60, s % 60)
}

struct MiniPlayer: View {
    @EnvironmentObject var player: PlayerService

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.chromeEdge).frame(height: 1.5)
            GeometryReader { geo in
                Rectangle().fill(Theme.cyan)
                    .frame(width: geo.size.width * min(1, player.position / max(player.duration, 1)))
            }
            .frame(height: 2).background(Color.white.opacity(0.1)).accessibilityHidden(true)
            HStack(spacing: 10) {
                LED(on: player.isPlaying, color: Theme.red)
                VStack(alignment: .leading) {
                    Text(player.current?.title ?? "").lineLimit(1).foregroundStyle(Theme.label)
                    Text(player.current?.artist ?? "").font(.caption).foregroundStyle(Theme.labelDim).lineLimit(1)
                }
                Spacer(minLength: 0)
                PianoButton(action: { player.previous() }) { Image(systemName: "backward.fill") }
                    .accessibilityLabel("Previous")
                PianoButton(lit: player.isPlaying, action: { player.toggle() }) {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                PianoButton(action: { player.next() }) { Image(systemName: "forward.fill") }
                    .accessibilityLabel("Next")
            }
            .padding(.horizontal).padding(.vertical, 6)
        }
        .background(Theme.panel)
        .contentShape(Rectangle())
    }
}

private struct Tonearm: View {
    let angle: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let pivot = CGPoint(x: w * 0.92, y: w * 0.08)
            let len = w * 0.78
            ZStack {
                Canvas { ctx, _ in
                    var arm = Path()
                    arm.move(to: pivot)
                    arm.addLine(to: CGPoint(x: pivot.x, y: pivot.y + len))
                    ctx.stroke(arm, with: .color(.black.opacity(0.4)), lineWidth: w * 0.03)
                    ctx.stroke(arm, with: .linearGradient(Gradient(colors: [.white, Color(white: 0.5), .white]),
                                                          startPoint: CGPoint(x: pivot.x - 4, y: 0),
                                                          endPoint: CGPoint(x: pivot.x + 4, y: 0)), lineWidth: w * 0.018)
                    let head = CGRect(x: pivot.x - w * 0.03, y: pivot.y + len - w * 0.02, width: w * 0.06, height: w * 0.1)
                    ctx.fill(Path(roundedRect: head, cornerRadius: 2), with: .color(Color(white: 0.12)))
                    ctx.stroke(Path(roundedRect: head, cornerRadius: 2), with: .color(.white.opacity(0.8)), lineWidth: 1)
                    let base = CGRect(x: pivot.x - w * 0.07, y: pivot.y - w * 0.07, width: w * 0.14, height: w * 0.14)
                    ctx.fill(Path(ellipseIn: base), with: .color(Color(white: 0.1)))
                    ctx.stroke(Path(ellipseIn: base), with: .color(.white.opacity(0.85)), lineWidth: 2)
                    let cap = base.insetBy(dx: w * 0.04, dy: w * 0.04)
                    ctx.fill(Path(ellipseIn: cap), with: .linearGradient(Gradient(colors: [.white, Color(white: 0.4)]),
                                                                          startPoint: cap.origin, endPoint: CGPoint(x: cap.maxX, y: cap.maxY)))
                }
                .frame(width: w, height: w)
                .rotationEffect(.degrees(angle), anchor: UnitPoint(x: 0.92, y: 0.08))
                .animation(.easeInOut(duration: 0.9), value: angle)
            }
        }
        .accessibilityHidden(true)
    }
}

struct Turntable: View {
    @EnvironmentObject var player: PlayerService
    @State private var base = 0.0
    @State private var started: Date?
    private let rpm = 33.3 * 360 / 60

    private func angle(at date: Date) -> Double {
        base + (started.map { date.timeIntervalSince($0) } ?? 0) * rpm
    }

    var body: some View {
        let progress = min(1, player.position / max(player.duration, 1))
        let arm = player.isPlaying ? 20 + 14 * progress : 0
        ZStack {
            RoundedRectangle(cornerRadius: 6).fill(Theme.panel)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.chromeEdge, lineWidth: 2))
            GeometryReader { geo in
                let d = geo.size.width * 0.86
                TimelineView(.animation(paused: started == nil)) { ctx in
                    Platter(art: player.current?.thumbnail)
                        .frame(width: d, height: d)
                        .rotationEffect(.degrees(angle(at: ctx.date)))
                }
                .position(x: geo.size.width * 0.5, y: geo.size.height * 0.5)
            }
            Tonearm(angle: arm)
        }
        .aspectRatio(1, contentMode: .fit)
        .frame(maxWidth: 340)
        .onAppear { if player.isPlaying { started = Date() } }
        .onChange(of: player.isPlaying) { _, playing in
            if playing { started = Date() }
            else { base = angle(at: Date()).truncatingRemainder(dividingBy: 360); started = nil }
        }
        .accessibilityHidden(true)
    }
}

private struct Platter: View {
    let art: String?

    var body: some View {
        GeometryReader { geo in
            let d = geo.size.width
            ZStack {
                Circle().fill(Theme.chrome)
                Circle().stroke(style: StrokeStyle(lineWidth: d * 0.025, dash: [1.5, 2.5]))
                    .foregroundStyle(.black.opacity(0.6)).padding(d * 0.0125)
                Circle().fill(Color(white: 0.09)).padding(d * 0.03)
                ForEach(0..<9, id: \.self) { i in
                    Circle().stroke(Color.white.opacity(0.05), lineWidth: 1).padding(d * (0.06 + 0.04 * Double(i)))
                }
                Circle().fill(AngularGradient(colors: [.white.opacity(0.0), .white.opacity(0.1), .white.opacity(0.0),
                                                       .white.opacity(0.1), .white.opacity(0.0)], center: .center))
                    .padding(d * 0.05)
                CoverImage(source: art)
                .frame(width: d * 0.34, height: d * 0.34).clipShape(Circle())
                Circle().fill(Theme.chrome).frame(width: d * 0.04, height: d * 0.04)
            }
        }
    }
}
