import SwiftUI

/// The one lit button of a sheet: accent fill, on-accent label, soft glow.
/// Disabled: accent-tint fill, ink-faint label, no glow.
struct LitButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(T.headline).foregroundStyle(enabled ? DS.Color.onAccent : DS.Color.inkFaint)
            .frame(maxWidth: .infinity, minHeight: 52).padding(.horizontal, DS.Space.space4)
            .background {
                if enabled { Capsule().fill(DS.Color.accent).shadow(color: DS.Color.accent.opacity(0.5), radius: 12) }
                else { Capsule().fill(DS.Color.accentTint) }
            }
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
