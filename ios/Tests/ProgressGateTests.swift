import XCTest
@testable import AudioPlayer

final class ProgressGateTests: XCTestCase {
    func testFirstValueAlwaysPasses() {
        let gate = ProgressGate(interval: 0.25)
        XCTAssertTrue(gate.admit(0, at: 10))
    }

    func testSamePercentIsDropped() {
        let gate = ProgressGate(interval: 0.25)
        XCTAssertTrue(gate.admit(0.101, at: 10))
        XCTAssertFalse(gate.admit(0.109, at: 11))
    }

    func testNewPercentWithinTheIntervalIsDropped() {
        let gate = ProgressGate(interval: 0.25)
        XCTAssertTrue(gate.admit(0.10, at: 10))
        XCTAssertFalse(gate.admit(0.11, at: 10.1))
        XCTAssertTrue(gate.admit(0.12, at: 10.26))
    }

    func testCompletionAlwaysPasses() {
        let gate = ProgressGate(interval: 0.25)
        XCTAssertTrue(gate.admit(0.99, at: 10))
        XCTAssertTrue(gate.admit(1, at: 10.01))
        XCTAssertFalse(gate.admit(1, at: 10.02))
    }

    func testOutOfRangeValuesAreClamped() {
        let gate = ProgressGate(interval: 0)
        XCTAssertTrue(gate.admit(-0.5, at: 1))
        XCTAssertFalse(gate.admit(0, at: 2))
        XCTAssertTrue(gate.admit(1.5, at: 3))
        XCTAssertFalse(gate.admit(1, at: 4))
    }

    func testAFastDownloadReachesTheScreenAtTheIntervalNotPerChunk() {
        let gate = ProgressGate(interval: 0.25)
        var passed = 0
        for chunk in 0...1000 where gate.admit(Double(chunk) / 1000, at: 100 + Double(chunk) * 0.002) { passed += 1 }
        XCTAssertLessThanOrEqual(passed, 10)
        XCTAssertGreaterThanOrEqual(passed, 8)
    }
}
