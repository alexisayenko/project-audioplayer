import SwiftUI

private struct ScaledIcon: ViewModifier {
    let size: CGFloat
    let weight: Font.Weight
    @ScaledMetric(relativeTo: .body) private var factor: CGFloat = 1

    func body(content: Content) -> some View {
        content.font(.system(size: size * min(factor, ScaledIcon.maxFactor), weight: weight))
    }

    static let maxFactor: CGFloat = 1.8
}

extension View {
    /// A symbol that grows with Dynamic Type like body text, up to 1.8 times its design size so fixed hit frames and rows still fit.
    func dsIcon(_ size: CGFloat, weight: Font.Weight = .regular) -> some View {
        modifier(ScaledIcon(size: size, weight: weight))
    }
}
