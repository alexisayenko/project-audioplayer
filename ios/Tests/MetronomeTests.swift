import XCTest
@testable import AudioPlayer

final class MetronomeLogicTests: XCTestCase {
    func testTapTempoAveragesIntervals() {
        var taps = TapTempo()
        XCTAssertNil(taps.tap(at: 10))
        XCTAssertEqual(taps.tap(at: 10.5), 120)
        XCTAssertEqual(taps.tap(at: 11.0), 120)
        XCTAssertEqual(taps.tap(at: 11.5), 120)
    }

    func testTapTempoRestartsAfterAPause() {
        var taps = TapTempo()
        _ = taps.tap(at: 0)
        _ = taps.tap(at: 0.5)
        XCTAssertNil(taps.tap(at: 10))
        XCTAssertEqual(taps.tap(at: 10.6), 100)
    }

    func testTapTempoClampsToTheRange() {
        var taps = TapTempo()
        _ = taps.tap(at: 0)
        XCTAssertEqual(taps.tap(at: 0.1), 300)
        var slow = TapTempo()
        _ = slow.tap(at: 0)
        XCTAssertEqual(slow.tap(at: 2.4), 30)
    }

    func testParseClampsAndRejectsText() {
        XCTAssertEqual(MetronomeMath.parse("128"), 128)
        XCTAssertEqual(MetronomeMath.parse(" 5 "), 30)
        XCTAssertEqual(MetronomeMath.parse("999"), 300)
        XCTAssertNil(MetronomeMath.parse("fast"))
        XCTAssertNil(MetronomeMath.parse(""))
    }

    func testSamplesPerBeatAndBar() {
        XCTAssertEqual(MetronomeMath.samplesPerBeat(bpm: 120, sampleRate: 48000), 24000, accuracy: 0.001)
        XCTAssertEqual(MetronomeMath.beatInBar(count: 0, beats: 4), 0)
        XCTAssertEqual(MetronomeMath.beatInBar(count: 5, beats: 4), 1)
    }

    func testRenderPlacesClicksOnExactSamples() {
        let state = ClickState(sampleRate: 48000, bpm: 120, beats: 4)
        let frames = 48000
        let left = UnsafeMutablePointer<Float>.allocate(capacity: frames)
        defer { left.deallocate() }
        state.render(frames: frames, hostTime: 0, left: left, right: nil)
        XCTAssertEqual(state.beatCount.pointee, 2)
        XCTAssertEqual((3000..<frames).first { left[$0] != 0 }, 24001)
        XCTAssertEqual(left[23999], 0)
    }
}
