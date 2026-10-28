import SwiftUI

struct TransportKeyStyle: ButtonStyle {
    enum Kind { case key, lit, ghost(on: Bool) }
    var kind: Kind
    @Environment(\.isEnabled) private var enabled
    @ScaledMetric(relativeTo: .body) private var heightFactor: CGFloat = 1

    private var foreground: Color {
        switch kind {
        case .lit: return DS.Color.onAccent
        case .ghost(let on): return on ? DS.Color.accentInk : DS.Color.inkMuted
        case .key: return DS.Color.ink
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        let lit: Bool = { if case .lit = kind { return true }; return false }()
        let ghost: Bool = { if case .ghost = kind { return true }; return false }()
        let size = lit ? CGSize(width: 64, height: 48) : CGSize(width: ghost ? DS.Space.hit : 56, height: DS.Space.hit)
        return configuration.label
            .dsIcon(lit ? 22 : 20)
            .foregroundStyle(foreground)
            .frame(width: size.width, height: size.height * min(heightFactor, 1.4))
            .background {
                switch kind {
                case .lit:
                    RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.accent)
                        .shadow(color: DS.Color.accent.opacity(0.5), radius: 12)
                case .key:
                    RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceKey)
                        .shadow(color: DS.Color.vinyl.opacity(0.2), radius: 2, y: 1)
                case .ghost(let on):
                    RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous)
                        .fill(on ? DS.Color.accentTint : Color.clear)
                }
            }
            .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
    }
}

/// Transport tray: shuffle, previous, lit play/pause, next, repeat.
struct TransportTray: View {
    let playing: Bool
    let shuffle: Bool
    let repeatMode: PlayerService.RepeatMode
    let onShuffle: () -> Void
    let onPrevious: () -> Void
    let onToggle: () -> Void
    let onNext: () -> Void
    let onRepeat: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onShuffle) { Image(systemName: "shuffle") }
                .buttonStyle(TransportKeyStyle(kind: .ghost(on: shuffle)))
                .accessibilityLabel("Shuffle").accessibilityValue(shuffle ? "on" : "off")
            Spacer(minLength: DS.Space.space2)
            Button(action: onPrevious) { Image(systemName: "backward.end.fill") }
                .buttonStyle(TransportKeyStyle(kind: .key)).accessibilityLabel("Previous song")
            Spacer(minLength: DS.Space.space2)
            Button(action: onToggle) { Image(systemName: playing ? "pause.fill" : "play.fill") }
                .buttonStyle(TransportKeyStyle(kind: .lit)).accessibilityLabel(playing ? "Pause" : "Play")
            Spacer(minLength: DS.Space.space2)
            Button(action: onNext) { Image(systemName: "forward.end.fill") }
                .buttonStyle(TransportKeyStyle(kind: .key)).accessibilityLabel("Next song")
            Spacer(minLength: DS.Space.space2)
            Button(action: onRepeat) { Image(systemName: repeatMode == .one ? "repeat.1" : "repeat") }
                .buttonStyle(TransportKeyStyle(kind: .ghost(on: repeatMode != .off)))
                .accessibilityLabel("Repeat").accessibilityValue(repeatMode.spokenName)
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
        .dsFloat(radius: DS.Radius.radiusTray)
    }
}

/// A flat horizontal bar: sunken track, strong-fill progress (3:1 on the ground by day), round paper thumb with a ring. Draggable.
struct DSSlider: View {
    @Binding var value: Double
    var range: ClosedRange<Double> = 0...1
    var label: String
    var disabled = false
    var tapStep: Double? = nil
    var valueText: ((Double) -> String)?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        GeometryReader { geo in
            let span = max(range.upperBound - range.lowerBound, 0.0001)
            let frac = min(1, max(0, (value - range.lowerBound) / span))
            let track = max(geo.size.width - 16, 1)
            let x = track * frac
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken).dsEdge(Capsule()).frame(height: 6)
                Capsule().fill(scheme.progressFill(contrast)).frame(width: x + 8, height: 6)
                Circle().fill(scheme == .dark ? DS.Color.ink : DS.Color.surface).frame(width: 16, height: 16)
                    .overlay(Circle().strokeBorder(scheme.progressFill(contrast), lineWidth: DS.Stroke.strokeFocus))
                    .shadow(color: DS.Color.vinyl.opacity(0.3), radius: 2, y: 1)
                    .offset(x: x)
            }
            .frame(height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: tapStep == nil ? 0 : 10).onChanged { g in
                guard !disabled, geo.size.width > 0 else { return }
                value = range.lowerBound + span * min(1, max(0, (g.location.x - 8) / track))
            })
            .simultaneousGesture(SpatialTapGesture().onEnded { tap in
                guard !disabled, let tapStep, geo.size.width > 0 else { return }
                let tapped = range.lowerBound + span * min(1, max(0, (tap.location.x - 8) / track))
                guard let target = PlaybackSeek.tapTarget(current: value, duration: range.upperBound,
                                                          tapped: tapped, step: tapStep) else { return }
                value = max(range.lowerBound, target)
            })
        }
        .frame(height: DS.Space.hit)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(valueText?(value) ?? "\(Int(((value - range.lowerBound) / max(range.upperBound - range.lowerBound, 0.0001)) * 100)) percent")
        .accessibilityAdjustableAction { dir in
            let step = (range.upperBound - range.lowerBound) * 0.05
            switch dir {
            case .increment: value = min(range.upperBound, value + step)
            case .decrement: value = max(range.lowerBound, value - step)
            @unknown default: break
            }
        }
    }
}

func formatTime(_ seconds: Double) -> String {
    let s = Int(max(seconds, 0))
    return String(format: "%d:%02d", s / 60, s % 60)
}
