import Foundation

/// Pure port of `web/js/live-bpm.js`, `web/js/mic-bpm.js` and `web/js/bpm-label.js` (task-0073, task-0113): same constants, same algorithm, no audio framework.
enum LiveBPMConst {
    static let minBPM = 30.0
    static let maxBPM = 1200.0
    static let windowS = 6.0
    static let minSpanS = 4.0
    static let shortS = 3.0
    static let agreeTolerance = 0.03
    static let envRate = 400.0
    static let hintTolerance = 0.04
    static let tieMargin = 0.15
    static let fundamentalTie = 0.05
    static let lockMin = 0.3
    static let crestMin = 6.0

    static let lowHz = 150.0
    static let midHz = 1500.0
    static let energyTauS = [0.012, 0.004, 0.0015]
    static let energyRef = 1e-6
    static let diffS = 0.006
    static let normTauS = 2.0
    static let normFloor = 0.3
    static let warmFrames = 30
    static let peakMin = 0.05
    static let wideSigmaS = 0.022
    static let smoothingLadder: [(sigma: Double, limit: Double)] = [(wideSigmaS, 250), (0.008, .infinity)]
    static let taperS = 1.0
    static let crestTop = 0.02
    static let usualMinBPM = 60.0
    static let usualMaxBPM = 200.0
    static let matchTolerance = 0.03
    static let harmonicFloor = 0.5

    static let publishS = 0.5
    static let smoothCount = 3
    static let silentRMS = 0.002
    static let silentHoldS = 1.5
    static let maxRunS = 10.0 * 60.0
    static let meterFloorDB = -60.0
    static let meterCeilDB = -6.0
    static let meterFall = 0.06
    static let decimalsMax = 200.0
    static let idleLabel = "- - -"
}

/// Splits the input into three bands and turns their energy rises into one onset envelope at about 400 frames per second.
final class OnsetExtractor {
    let rate: Double
    private let hop: Int
    private let aLow: Double
    private let aMid: Double
    private let aEnergy: [Double]
    private let aNorm: Double
    private let depth: Int
    private var ring: [[Double]]
    private var energy = [0.0, 0.0, 0.0]
    private var mean = [0.0, 0.0, 0.0]
    private var l1 = 0.0
    private var l2 = 0.0
    private var m1 = 0.0
    private var m2 = 0.0
    private var count = 0
    private var step = 0

    init(sampleRate: Double) {
        hop = max(1, Int((sampleRate / LiveBPMConst.envRate).rounded()))
        rate = sampleRate / Double(hop)
        func pole(_ hz: Double) -> Double { 1 - exp(-2 * Double.pi * hz / sampleRate) }
        aLow = pole(LiveBPMConst.lowHz)
        aMid = pole(LiveBPMConst.midHz)
        aEnergy = LiveBPMConst.energyTauS.map { 1 - exp(-1 / (sampleRate * $0)) }
        aNorm = 1 - exp(-1 / (rate * LiveBPMConst.normTauS))
        depth = max(1, Int((LiveBPMConst.diffS * rate).rounded()))
        ring = Array(repeating: Array(repeating: 0.0, count: depth + 1), count: 3)
    }

    private func frame() -> Double {
        var onset = 0.0
        for b in 0..<3 {
            let level = log(1 + energy[b] / LiveBPMConst.energyRef)
            let back = ring[b][(step + 1) % (depth + 1)]
            ring[b][step % (depth + 1)] = level
            let rise = step >= LiveBPMConst.warmFrames ? max(0, level - back) : 0
            mean[b] += aNorm * (rise - mean[b])
            onset += rise / (mean[b] + LiveBPMConst.normFloor)
        }
        step += 1
        return onset
    }

    func push(_ samples: [Float], into out: inout [Double]) {
        for sample in samples {
            let x = Double(sample)
            l1 += aLow * (x - l1)
            l2 += aLow * (l1 - l2)
            m1 += aMid * (x - m1)
            m2 += aMid * (m1 - m2)
            let mid = m2 - l2
            let high = x - m2
            energy[0] += aEnergy[0] * (l2 * l2 - energy[0])
            energy[1] += aEnergy[1] * (mid * mid - energy[1])
            energy[2] += aEnergy[2] * (high * high - energy[2])
            count += 1
            if count == hop {
                count = 0
                out.append(frame())
            }
        }
    }
}

enum TempoEstimator {
    private struct Peak {
        var lag: Double
        var h: Double
        var hc: Double
    }

    private static func at(_ r: [Double], _ i: Int) -> Double { i >= 0 && i < r.count ? r[i] : 0 }

    private static func taperWindow(_ n: Int, _ rate: Double) -> [Double] {
        var w = [Double](repeating: 1, count: n)
        let ramp = min(n / 2, Int((LiveBPMConst.taperS * rate).rounded()))
        for i in 0..<n {
            let edge = min(i, n - 1 - i)
            if edge < ramp {
                let s = sin(Double.pi / 2 * (Double(edge) / Double(ramp)))
                w[i] = s * s
            }
        }
        return w
    }

    private static func windowedCorrelation(_ w: [Double], _ lag: Int) -> Double {
        var num = 0.0
        var den = 0.0
        let end = w.count - lag
        for i in 0..<w.count {
            den += w[i] * w[i]
            if i < end { num += w[i] * w[i + lag] }
        }
        return num / den
    }

    private static func autocorrelation(_ x: [Double], _ minLag: Int, _ maxLag: Int, _ extra: Int) -> (r: [Double], power: Double) {
        let n = x.count
        var power = 0.0
        for v in x { power += v * v }
        var r = [Double](repeating: 0, count: maxLag + 2)
        if power <= 1e-12 { return (r, 0) }
        r[0] = 1
        var lag = 1
        while lag <= min(maxLag, n - 1) {
            if !(lag > extra && lag < minLag) {
                var sum = 0.0
                for i in 0..<(n - lag) { sum += x[i] * x[i + lag] }
                r[lag] = sum / power
            }
            lag += 1
        }
        return (r, power)
    }

    private static func kernelHalf(_ rate: Double) -> Int { Int((2.5 * LiveBPMConst.wideSigmaS * rate).rounded(.up)) }

    private static func smoothed(_ r: [Double], _ minLag: Int, _ maxLag: Int, _ sigma: Double) -> [Double] {
        var out = [Double](repeating: 0, count: r.count)
        let reach = Int((2.5 * sigma).rounded(.up))
        var kernel = [Double](repeating: 0, count: reach + 1)
        for j in 0...reach { kernel[j] = exp(-Double(j * j) / (2 * sigma * sigma)) }
        var zero = at(r, 0) * kernel[0]
        if reach >= 1 { for j in 1...reach { zero += 2 * kernel[j] * at(r, j) } }
        if minLag <= maxLag {
            for i in minLag...maxLag {
                var sum = kernel[0] * at(r, i)
                if reach >= 1 { for j in 1...reach { sum += kernel[j] * (at(r, i - j) + at(r, i + j)) } }
                out[i] = sum / zero
            }
        }
        return out
    }

    private static func findPeaks(_ r: [Double], _ minLag: Int, _ maxLag: Int, _ w: [Double]) -> [Peak] {
        var peaks: [Peak] = []
        guard minLag + 1 < maxLag else { return peaks }
        for i in (minLag + 1)..<maxLag {
            let b = r[i]
            if b < LiveBPMConst.peakMin || b <= r[i - 1] || b < r[i + 1] { continue }
            let a = r[i - 1]
            let c = r[i + 1]
            let denom = a - 2 * b + c
            let off = denom < 0 ? (0.5 * (a - c)) / denom : 0
            let h = b - 0.25 * (a - c) * off
            peaks.append(Peak(lag: Double(i) + off, h: h, hc: h / max(0.05, windowedCorrelation(w, i))))
        }
        return peaks
    }

    private static func nearest(_ peaks: [Peak], _ lag: Double) -> Peak? {
        var best: Peak?
        var bestD = Double.infinity
        let tol = lag * LiveBPMConst.matchTolerance + 1.5
        for p in peaks {
            let d = abs(p.lag - lag)
            if d <= tol && d < bestD { best = p; bestD = d }
        }
        return best
    }

    private static func refine(_ peaks: [Peak], _ first: Peak, _ maxLag: Int) -> Double {
        var sumLag = first.lag * first.hc
        var sumK = first.hc
        var current = first.lag
        var k = 2.0
        while k * current <= Double(maxLag) {
            let want = k * current
            var hit: Peak?
            var hitD = Double.infinity
            for p in peaks {
                let d = abs(p.lag - want)
                if d <= 0.3 * current && d < hitD { hit = p; hitD = d }
            }
            guard let h = hit, h.hc >= LiveBPMConst.harmonicFloor * first.hc else { break }
            sumLag += h.lag * k * h.hc
            sumK += k * k * h.hc
            current = sumLag / sumK
            k += 1
        }
        return current
    }

    private static func pick(_ r: [Double], _ w: [Double], _ minLag: Int, _ maxLag: Int, _ rate: Double, _ hint: Double?, _ sigmaS: Double) -> Double? {
        let peaks = findPeaks(smoothed(r, minLag, maxLag, sigmaS * rate), minLag, maxLag, w)
        if peaks.isEmpty { return nil }
        var top = 0.0
        for p in peaks where p.h > top { top = p.h }
        if top < LiveBPMConst.lockMin { return nil }
        var chosen: Peak?
        for p in peaks where p.h >= (1 - LiveBPMConst.fundamentalTie) * top {
            if chosen == nil || p.lag < chosen!.lag { chosen = p }
        }
        guard var pickPeak = chosen else { return nil }
        func bpmOf(_ lag: Double) -> Double { 60 * rate / lag }
        while true {
            guard let faster = nearest(peaks, pickPeak.lag / 2) else { break }
            if faster.lag < Double(minLag) || bpmOf(pickPeak.lag) >= LiveBPMConst.usualMinBPM || bpmOf(faster.lag) > LiveBPMConst.usualMaxBPM
                || faster.hc < (1 - LiveBPMConst.tieMargin) * pickPeak.hc { break }
            pickPeak = faster
        }
        if let hint, hint > 0 {
            let f = bpmOf(pickPeak.lag)
            if f <= LiveBPMConst.usualMaxBPM && abs(f - hint) / hint > LiveBPMConst.hintTolerance {
                for factor in [2.0, 0.5] {
                    let c = f * factor
                    if c < LiveBPMConst.minBPM || c > LiveBPMConst.usualMaxBPM || abs(c - hint) / hint > LiveBPMConst.hintTolerance { continue }
                    if let match = nearest(peaks, pickPeak.lag / factor), match.hc >= (1 - LiveBPMConst.tieMargin) * pickPeak.hc {
                        pickPeak = match
                        break
                    }
                }
            }
        }
        let bpm = bpmOf(refine(peaks, pickPeak, maxLag))
        return bpm >= LiveBPMConst.minBPM * 0.97 && bpm <= LiveBPMConst.maxBPM * 1.03 ? bpm : nil
    }

    private static func crest(_ env: ArraySlice<Float>) -> Double {
        let sorted = env.sorted()
        var total = 0.0
        for v in sorted { total += Double(v) }
        let count = max(1, Int((Double(sorted.count) * LiveBPMConst.crestTop).rounded(.up)))
        var top = 0.0
        for i in (sorted.count - count)..<sorted.count { top += Double(sorted[i]) }
        return total > 0 ? top / Double(count) / (total / Double(sorted.count)) : 0
    }

    static func estimate(_ env: ArraySlice<Float>, rate: Double, hint: Double? = nil, minSpanS: Double = LiveBPMConst.minSpanS) -> Double? {
        let n = env.count
        if Double(n) < minSpanS * rate { return nil }
        if crest(env) < LiveBPMConst.crestMin { return nil }
        let w = taperWindow(n, rate)
        var weight = 0.0
        var total = 0.0
        for (i, v) in env.enumerated() { weight += w[i]; total += w[i] * Double(v) }
        let mean = total / weight
        var x = [Double](repeating: 0, count: n)
        for (i, v) in env.enumerated() { x[i] = (Double(v) - mean) * w[i] }
        let half = kernelHalf(rate)
        let minLag = max(2, Int((60 * rate / LiveBPMConst.maxBPM).rounded(.down)) - 2)
        let maxLag = min(Int((60 * rate / LiveBPMConst.minBPM).rounded(.up)) + 2, Int((Double(n) * 0.6).rounded(.down)))
        let (r, power) = autocorrelation(x, minLag - half, maxLag + half, half)
        if power == 0 { return nil }
        var found: Double?
        for step in LiveBPMConst.smoothingLadder {
            let bpm = pick(r, w, minLag, maxLag, rate, hint, step.sigma)
            if let bpm { found = bpm }
            if let bpm, bpm <= step.limit { return bpm }
        }
        return found
    }
}

/// Keeps the last six seconds of onset envelope and estimates the tempo from it (and from the last three seconds).
final class LiveBPMEngine {
    private let windowS: Double
    private let shortS: Double
    private var hint: Double?
    private var extractor: OnsetExtractor?
    private var extractorRate = 0.0
    private var env: [Float] = []
    private var filled = 0

    init(windowS: Double = LiveBPMConst.windowS, shortS: Double = LiveBPMConst.shortS) {
        self.windowS = windowS
        self.shortS = shortS
    }

    func setHint(_ bpm: Double?) { hint = (bpm ?? 0) > 0 ? bpm : nil }

    func reset() {
        filled = 0
        extractor = nil
    }

    var envelopeLength: Int { filled }

    func push(_ samples: [Float], sampleRate: Double) {
        if extractor == nil || extractorRate != sampleRate {
            let e = OnsetExtractor(sampleRate: sampleRate)
            extractor = e
            extractorRate = sampleRate
            env = [Float](repeating: 0, count: Int((windowS * e.rate).rounded(.up)))
            filled = 0
        }
        guard let extractor else { return }
        var scratch: [Double] = []
        extractor.push(samples, into: &scratch)
        let add = scratch.count
        if add == 0 { return }
        let cap = env.count
        if add >= cap {
            for i in 0..<cap { env[i] = Float(scratch[add - cap + i]) }
            filled = cap
            return
        }
        if filled + add > cap {
            let drop = filled + add - cap
            for i in 0..<(filled - drop) { env[i] = env[i + drop] }
            filled -= drop
        }
        for i in 0..<add { env[filled + i] = Float(scratch[i]) }
        filled += add
    }

    func estimateExact() -> Double? {
        guard let extractor else { return nil }
        let rate = extractor.rate
        let all = env[0..<filled]
        let long = TempoEstimator.estimate(all, rate: rate, hint: hint)
        let recentN = Int((shortS * rate).rounded())
        if filled < recentN { return long }
        let short = TempoEstimator.estimate(env[(filled - recentN)..<filled], rate: rate, hint: hint, minSpanS: shortS)
        guard let short, let long else {
            return long == nil && Double(filled) < LiveBPMConst.minSpanS * rate ? short : long
        }
        return Self.sameTempo(short, long) ? long : short
    }

    static func sameTempo(_ a: Double, _ b: Double) -> Bool {
        let octaves = log2(a / b)
        return abs(pow(2, octaves - octaves.rounded()) - 1) <= LiveBPMConst.agreeTolerance
    }
}

/// Microphone front end: silence gate (RMS under 0.002 for 1.5 s shows idle and clears the detector) and a median of the last three estimates.
final class MicBPM {
    private let engine: LiveBPMEngine
    private var quietS = 0.0
    private var recent: [Double] = []
    private(set) var silent = true

    init(engine: LiveBPMEngine = LiveBPMEngine()) { self.engine = engine }

    static func rms(_ samples: [Float]) -> Double {
        if samples.isEmpty { return 0 }
        var sum = 0.0
        for s in samples { sum += Double(s) * Double(s) }
        return (sum / Double(samples.count)).squareRoot()
    }

    static func levelFraction(_ rms: Double) -> Double {
        if rms.isNaN || rms <= 0 { return 0 }
        let db = 20 * log10(rms)
        return min(1, max(0, (db - LiveBPMConst.meterFloorDB) / (LiveBPMConst.meterCeilDB - LiveBPMConst.meterFloorDB)))
    }

    func push(_ samples: [Float], sampleRate: Double) {
        if samples.isEmpty || sampleRate.isNaN || sampleRate <= 0 { return }
        quietS = Self.rms(samples) < LiveBPMConst.silentRMS ? quietS + Double(samples.count) / sampleRate : 0
        let quiet = quietS >= LiveBPMConst.silentHoldS
        if quiet && !silent { engine.reset(); recent = [] }
        silent = quiet
        if !quiet { engine.push(samples, sampleRate: sampleRate) }
    }

    /// The smoothed tempo to show, to one decimal; nil while silent or not locked.
    func value() -> Double? {
        if silent { return nil }
        if let bpm = engine.estimateExact(), bpm.isFinite, bpm > 0 { recent.append(bpm) } else if !recent.isEmpty { recent.removeFirst() }
        if recent.count > LiveBPMConst.smoothCount { recent.removeFirst() }
        if recent.isEmpty { return nil }
        let sorted = recent.sorted()
        return (sorted[sorted.count >> 1] * 10).rounded() / 10
    }

    func reset() {
        engine.reset()
        recent = []
        quietS = 0
        silent = true
    }
}

enum BPMLabel {
    /// Live label: one decimal up to and including 200 BPM, integer above; empty for no value.
    static func live(_ bpm: Double?) -> String {
        guard let v = bpm, v.isFinite, v > 0 else { return "" }
        return v <= LiveBPMConst.decimalsMax ? String(format: "%.1f", v) : String(Int(v.rounded()))
    }
}
