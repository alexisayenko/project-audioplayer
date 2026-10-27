#if os(iOS)
import SwiftUI
import UIKit

/// Tools screen: a list of tool cards: Live BPM (microphone) and the metronome. More tools (task-0110 to task-0112) get their own cards here.
/// The microphone and the metronome never run together, and both stop when the screen is left or the app goes to the background.
struct ToolsView: View {
    var isVisible = true

    @EnvironmentObject var player: PlayerService
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var mic = MicBPMModel()
    @StateObject private var metronome = MetronomeModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space3) {
                LiveBPMCard(mic: mic)
                VStack(alignment: .leading, spacing: DS.Space.space2) {
                    SectionLabel("Metronome")
                    MetronomeCard(model: metronome, beforeStart: { mic.stop() })
                }
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            ScreenHeader(title: "Tools").padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2)
                .background(DS.Color.ground)
        }
        .scrollDismissesKeyboard(.interactively)
        .dsGround()
        .onAppear {
            mic.isPlayerPlaying = { [weak player] in player?.isPlaying ?? false }
            metronome.isMicListening = { [weak mic] in (mic?.running ?? false) || (mic?.busy ?? false) }
        }
        .onChange(of: mic.phase) { _, phase in if phase == .asking || phase == .listening { metronome.stop(ownPlayback: player.isPlaying) } }
        .onChange(of: isVisible) { _, visible in if !visible { stopAll() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                mic.stop(.backgrounded)
                metronome.stop(ownPlayback: player.isPlaying)
            }
        }
        .onDisappear { stopAll() }
    }

    private func stopAll() {
        mic.stop()
        metronome.stop(ownPlayback: player.isPlaying)
    }
}

private struct LiveBPMCard: View {
    @ObservedObject var mic: MicBPMModel
    @Environment(\.openURL) private var openURL
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var badgeSize: CGFloat = 40

    private var badgeText: String {
        let label = BPMLabel.live(mic.running ? mic.bpm : nil)
        return label.isEmpty ? LiveBPMConst.idleLabel : label
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            SectionLabel("Live BPM (microphone)")
            VStack(alignment: .leading, spacing: DS.Space.space3) {
                let stacked = typeSize.isAccessibilitySize
                let layout = stacked
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: DS.Space.space3))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: DS.Space.space3))
                layout {
                    badge
                    if !stacked { Spacer(minLength: DS.Space.space2) }
                    toggleButton
                }
                meter
                Text(mic.stateLine).font(T.subhead).foregroundStyle(mic.isProblem ? DS.Color.powerText : DS.Color.inkMuted)
                    .accessibilityAddTraits(.updatesFrequently)
                if mic.phase == .denied {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .buttonStyle(DSButtonStyle(kind: .outline))
                }
                Text("Hears the phone speaker through the microphone. Not headphones.").dsCaption()
            }
            .padding(DS.Space.space4)
            .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
        }
    }

    private var badge: some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.space1) {
            Text(badgeText).font(.system(size: min(badgeSize, 64), weight: .bold, design: .monospaced)).foregroundStyle(DS.Color.ink)
                .lineLimit(1).minimumScaleFactor(0.5)
            Text("BPM").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(mic.running && mic.bpm != nil ? "BPM \(BPMLabel.live(mic.bpm))" : "BPM not detected")
    }

    private var toggleButton: some View {
        Button { mic.toggle() } label: {
            Text(mic.running ? "Stop" : "Start")
                .font(T.subhead.weight(.semibold)).lineLimit(1)
                .foregroundStyle(mic.running ? DS.Color.accentInk : DS.Color.onAccent)
                .padding(.horizontal, DS.Space.space5)
                .frame(minWidth: 96, minHeight: DS.Space.hit)
                .background {
                    if mic.running { Capsule().stroke(DS.Color.accentInk, lineWidth: 1.5) } else { Capsule().fill(DS.Color.accent) }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(mic.busy)
        .opacity(mic.busy ? 0.4 : 1)
        .accessibilityLabel(mic.running ? "Stop listening" : "Start listening")
    }

    private var meter: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken).dsEdge(Capsule())
                Capsule().fill(scheme.progressFill(contrast)).frame(width: geo.size.width * mic.level)
            }
        }
        .frame(height: 8)
        .animation(.linear(duration: 0.1), value: mic.level)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Microphone level")
        .accessibilityValue("\(Int((mic.level * 100).rounded())) percent")
    }
}
#endif
