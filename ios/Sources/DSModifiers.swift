import SwiftUI

extension View {
    func dsShadow(_ level: DSShadow, tint: Color? = nil) -> some View {
        shadow(color: tint.map { $0.opacity(level.tintOpacity) } ?? level.color, radius: level.radius, x: level.x, y: level.y)
    }

    func dsAnimation<V: Equatable>(_ duration: Double = DS.Motion.durBase, curve: DSBezier = DS.Motion.easeOut, value: V) -> some View {
        modifier(DSAnimation(animation: .ds(duration, curve), value: value))
    }
}

private struct DSAnimation<V: Equatable>: ViewModifier {
    let animation: Animation
    let value: V
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : animation, value: value)
    }
}

extension Animation {
    static func ds(_ duration: Double = DS.Motion.durBase, _ curve: DSBezier = DS.Motion.easeOut) -> Animation {
        .timingCurve(curve.x1, curve.y1, curve.x2, curve.y2, duration: duration)
    }

    static var dsPulse: Animation {
        Animation.ds(DS.Motion.durPulse, DS.Motion.easeIo).repeatForever(autoreverses: true)
    }
}

var dsReduceMotion: Bool {
#if canImport(UIKit)
    UIAccessibility.isReduceMotionEnabled
#else
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
#endif
}

@discardableResult
func dsWithAnimation<R>(_ duration: Double = DS.Motion.durBase, curve: DSBezier = DS.Motion.easeOut, _ body: () throws -> R) rethrows -> R {
    try withAnimation(dsReduceMotion ? nil : .ds(duration, curve), body)
}
