enum PlaybackSeek {
    static func tapTarget(current: Double, duration: Double, tapped: Double, step: Double = 5) -> Double? {
        guard current.isFinite, duration.isFinite, duration > 0,
              tapped.isFinite, step.isFinite, step > 0 else { return nil }
        let position = min(max(current, 0), duration)
        if tapped < position { return max(0, position - step) }
        if tapped > position { return min(duration, position + step) }
        return nil
    }
}
