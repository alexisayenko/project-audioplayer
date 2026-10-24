import Foundation

enum MetronomeLimits {
    static let bpm: ClosedRange<Int> = 30...300
    static let beats: ClosedRange<Int> = 2...7
    static let defaultBPM = 100
    static let defaultBeats = 4
}

/// Tap-tempo: the mean of the last few intervals between taps; a pause of more than 2.5 s starts a new count.
struct TapTempo {
    static let timeout = 2.5
    static let keep = 6

    private var taps: [TimeInterval] = []

    mutating func tap(at time: TimeInterval) -> Int? {
        if let last = taps.last, time - last > Self.timeout { taps.removeAll() }
        taps.append(time)
        if taps.count > Self.keep + 1 { taps.removeFirst() }
        guard taps.count >= 2 else { return nil }
        let mean = (taps.last! - taps.first!) / Double(taps.count - 1)
        guard mean > 0 else { return nil }
        return Self.clamp(Int((60 / mean).rounded()))
    }

    mutating func reset() { taps.removeAll() }

    static func clamp(_ bpm: Int) -> Int { min(max(bpm, MetronomeLimits.bpm.lowerBound), MetronomeLimits.bpm.upperBound) }
}

enum MetronomeMath {
    static func samplesPerBeat(bpm: Int, sampleRate: Double) -> Double { sampleRate * 60 / Double(bpm) }

    static func parse(_ text: String) -> Int? {
        guard let value = Int(text.trimmingCharacters(in: .whitespaces)) else { return nil }
        return TapTempo.clamp(value)
    }

    /// The index of the beat within the bar for a running beat count.
    static func beatInBar(count: Int, beats: Int) -> Int { count % max(beats, 1) }
}

/// Click shapes rendered once: a decaying sine burst, higher and louder for the accented first beat.
enum ClickSound {
    static func render(frequency: Double, amplitude: Float, sampleRate: Double) -> [Float] {
        let length = Int(sampleRate * 0.05)
        return (0..<length).map { i in
            let t = Double(i) / sampleRate
            let attack = min(1, Double(i) / (sampleRate * 0.001))
            return amplitude * Float(sin(2 * .pi * frequency * t) * exp(-t / 0.012) * attack)
        }
    }
}
