import XCTest
@testable import AudioPlayer

private final class BundleAnchor {}

private struct LabelCase: Decodable { let bpm: Double?; let label: String }
private struct RMSCase: Decodable { let samples: [Float]; let rms: Double }
private struct LevelCase: Decodable { let rms: Double; let fraction: Double }
private struct TempoCase: Decodable { let bpm: Double; let seconds: Double; let phase: Double; let tolerance: Double }

private struct BPMCases: Decodable {
    let label: [LabelCase]
    let rms: [RMSCase]
    let level: [LevelCase]
    let tempo: [TempoCase]
}

private func kickTrack(bpm: Double, seconds: Double, phase: Double, sampleRate: Double) -> [Float] {
    var buf = [Float](repeating: 0, count: Int((seconds * sampleRate).rounded()))
    let period = 60 / bpm
    var at = phase
    while at < seconds {
        let start = Int((at * sampleRate).rounded())
        let len = Int((0.3 * sampleRate).rounded())
        var ph = 0.0
        var i = 0
        while i < len && start + i < buf.count {
            let t = Double(i) / sampleRate
            ph += 2 * Double.pi * (48 + 90 * exp(-t / 0.02)) / sampleRate
            buf[start + i] += Float(0.8 * sin(ph) * exp(-t / 0.07))
            i += 1
        }
        at += period
    }
    return buf
}

final class LiveBPMTests: XCTestCase {
    private func cases() throws -> BPMCases {
        let url = try XCTUnwrap(Bundle(for: BundleAnchor.self).url(forResource: "live_bpm_cases", withExtension: "json"))
        return try JSONDecoder().decode(BPMCases.self, from: Data(contentsOf: url))
    }

    func testTheBPMLabelMatchesTheSharedCases() throws {
        for c in try cases().label { XCTAssertEqual(BPMLabel.live(c.bpm), c.label, String(describing: c.bpm)) }
    }

    func testTheRMSMatchesTheSharedCases() throws {
        for c in try cases().rms { XCTAssertEqual(MicBPM.rms(c.samples), c.rms, accuracy: 1e-9, String(describing: c.samples)) }
    }

    func testTheMeterLevelMatchesTheSharedCases() throws {
        for c in try cases().level { XCTAssertEqual(MicBPM.levelFraction(c.rms), c.fraction, accuracy: 1e-6, String(c.rms)) }
    }

    func testACleanKickTrackIsDetectedWithinTheSharedTolerance() throws {
        let rate = 44100.0
        for c in try cases().tempo {
            let engine = LiveBPMEngine()
            let audio = kickTrack(bpm: c.bpm, seconds: c.seconds, phase: c.phase, sampleRate: rate)
            var i = 0
            while i < audio.count {
                engine.push(Array(audio[i..<min(audio.count, i + 2205)]), sampleRate: rate)
                i += 2205
            }
            let got = try XCTUnwrap(engine.estimateExact(), "\(c.bpm)")
            XCTAssertEqual(got / c.bpm, 1, accuracy: c.tolerance, "\(c.bpm) gave \(got)")
        }
    }

    func testSilenceShowsNoValueAndClearsTheDetector() {
        let mic = MicBPM()
        let rate = 44100.0
        let loud = kickTrack(bpm: 120, seconds: 8, phase: 0.2, sampleRate: rate)
        var i = 0
        while i < loud.count {
            mic.push(Array(loud[i..<min(loud.count, i + 2205)]), sampleRate: rate)
            i += 2205
        }
        XCTAssertFalse(mic.silent)
        XCTAssertNotNil(mic.value())
        let quiet = [Float](repeating: 0, count: 2205)
        for _ in 0..<40 { mic.push(quiet, sampleRate: rate) }
        XCTAssertTrue(mic.silent)
        XCTAssertNil(mic.value())
    }

    func testTwoTempiAgreeWhenTheyDifferByWholeOctaves() {
        XCTAssertTrue(LiveBPMEngine.sameTempo(120, 60))
        XCTAssertTrue(LiveBPMEngine.sameTempo(120, 121))
        XCTAssertFalse(LiveBPMEngine.sameTempo(120, 90))
    }
}
