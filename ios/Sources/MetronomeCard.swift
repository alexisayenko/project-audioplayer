#if os(iOS)
import SwiftUI

struct MetronomeCard: View {
    @ObservedObject var model: MetronomeModel
    var beforeStart: (() -> Void)?
    @EnvironmentObject private var player: PlayerService
    @State private var editing = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var tempo: Binding<Double> {
        Binding(get: { Double(model.bpm) }, set: { model.bpm = Int($0.rounded()) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space4) {
            VStack(spacing: DS.Space.space3) {
                HStack(spacing: DS.Space.space3) {
                    stepButton("minus", label: "Slower", delta: -1)
                    tempoReadout.frame(maxWidth: .infinity)
                    stepButton("plus", label: "Faster", delta: 1)
                }
                DSSlider(value: tempo, range: Double(MetronomeLimits.bpm.lowerBound)...Double(MetronomeLimits.bpm.upperBound),
                         label: "Tempo", valueText: { "\(Int($0.rounded())) beats per minute" })
                beatDots
            }
            .padding(DS.Space.space4)
            .dsSlab()

            HStack(spacing: DS.Space.space3) {
                ToolPrimaryButton(title: model.running ? "Stop" : "Start",
                                  symbol: model.running ? "stop.fill" : "play.fill",
                                  filled: !model.running) {
                    focused = false
                    if !model.running { beforeStart?() }
                    model.toggle(ownPlayback: player.isPlaying)
                }
                .accessibilityLabel(model.running ? "Stop metronome" : "Start metronome")
                Button { model.tap() } label: { Text("Tap tempo") }
                    .buttonStyle(DSButtonStyle(kind: .outline))
                    .accessibilityHint("Tap repeatedly to the beat to set the tempo")
            }
            if let failed = model.failed {
                Text(failed).font(T.subhead).foregroundStyle(DS.Color.powerText)
            }

            VStack(alignment: .leading, spacing: DS.Space.space2) {
                SectionLabel("Beats per bar")
                HStack(spacing: DS.Space.space3) {
                    barButton("minus", label: "Fewer beats", delta: -1, enabled: model.beats > MetronomeLimits.beats.lowerBound)
                    Text("\(model.beats)").font(T.title).monospacedDigit().foregroundStyle(DS.Color.ink)
                        .frame(minWidth: DS.Space.space8).multilineTextAlignment(.center)
                        .accessibilityLabel("\(model.beats) beats per bar")
                    barButton("plus", label: "More beats", delta: 1, enabled: model.beats < MetronomeLimits.beats.upperBound)
                    Spacer(minLength: 0)
                }
                HStack {
                    Text("Haptic tick").font(T.subhead).foregroundStyle(DS.Color.ink)
                    Spacer(minLength: DS.Space.space3)
                    Toggle("Haptic tick", isOn: $model.hapticTick).labelsHidden().toggleStyle(DSSwitchStyle())
                }
            }
            .padding(DS.Space.space4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .dsSlab()

            Text("The first beat of each bar is higher. The click mixes with other audio and stops when you leave Tools.")
                .dsCaption()
        }
    }

    @ViewBuilder
    private var tempoReadout: some View {
        VStack(spacing: DS.Space.space1) {
            if editing {
                TextField("BPM", text: $draft, prompt: dsPrompt(String(model.bpm)))
                    .keyboardType(.numberPad).multilineTextAlignment(.center)
                    .font(T.display).monospacedDigit().foregroundStyle(DS.Color.ink)
                    .focused($focused)
                    .task { focused = true }
                    .submitLabel(.done)
                    .onSubmit(finishEditing)
                    .onChange(of: focused) { _, now in if !now { finishEditing() } }
                    .toolbar {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("Done", action: finishEditing)
                        }
                    }
                    .accessibilityLabel("Tempo in beats per minute")
            } else {
                Button {
                    draft = ""
                    editing = true
                } label: {
                    Text("\(model.bpm)").font(T.display).monospacedDigit().foregroundStyle(DS.Color.ink)
                        .contentTransition(.numericText())
                        .frame(minHeight: DS.Space.hit)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Tempo, \(model.bpm) beats per minute")
                .accessibilityHint("Double tap to type a tempo")
            }
            Text("BPM").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
        }
    }

    private func finishEditing() {
        guard editing else { return }
        editing = false
        focused = false
        model.commit(text: draft)
    }

    private var beatDots: some View {
        HStack(spacing: DS.Space.space3) {
            ForEach(0..<model.beats, id: \.self) { index in
                let lit = model.currentBeat == index
                Circle().fill(lit ? DS.Color.accent : DS.Color.surfaceSunken)
                    .overlay(Circle().stroke(DS.Color.accentInk, lineWidth: index == 0 ? DS.Stroke.strokeThin : 0))
                    .frame(width: DS.Control.controlSm, height: DS.Control.controlSm)
                    .scaleEffect(lit ? 1.15 : 1)
                    .dsAnimation(DS.Motion.durFast, value: lit)
            }
        }
        .frame(maxWidth: .infinity, minHeight: DS.Control.controlSm * 1.4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.running ? "Beat \((model.currentBeat ?? -1) + 1) of \(model.beats)" : "\(model.beats) beats per bar")
    }

    private func stepButton(_ symbol: String, label: String, delta: Int) -> some View {
        Button { model.nudge(delta) } label: {
            Image(systemName: symbol).font(.system(size: DS.Icon.iconPlay, weight: DS.Icon.iconWeightStrong))
                .foregroundStyle(DS.Color.ink)
                .frame(width: DS.Space.hit, height: DS.Space.hit)
                .background(Circle().fill(DS.Color.surfaceKey).dsShadow(DS.Shadow.depthKey))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func barButton(_ symbol: String, label: String, delta: Int, enabled: Bool) -> some View {
        Button { model.beats += delta } label: {
            Image(systemName: symbol).font(.system(size: DS.Icon.iconAction, weight: DS.Icon.iconWeightStrong))
                .foregroundStyle(DS.Color.ink)
                .frame(width: DS.Space.hit, height: DS.Space.hit)
                .background(Circle().fill(DS.Color.surfaceKey).dsShadow(DS.Shadow.depthKey))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

/// The wide pill for Start and Stop: the lit accent fill with on-accent label (the primary button of every screen), or an outline while running.
struct ToolPrimaryButton: View {
    let title: String
    let symbol: String
    var filled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(T.subhead.weight(.semibold))
                .foregroundStyle(filled ? DS.Color.onAccent : DS.Color.accentInk)
                .frame(maxWidth: .infinity, minHeight: DS.Space.hit)
                .background(Capsule().fill(filled ? DS.Color.accent : Color.clear))
                .overlay(Capsule().stroke(DS.Color.accentInk, lineWidth: filled ? 0 : 1.5))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
#endif
