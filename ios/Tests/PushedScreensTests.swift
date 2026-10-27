import Combine
import SwiftUI
import XCTest
@testable import AudioPlayer

@MainActor
final class PushedScreensTests: XCTestCase {
    func testNoPushedScreenByDefault() {
        XCTAssertFalse(PushedScreens().hasPushed)
    }

    func testOnePushedScreenHidesTheEdgeSwipe() {
        let gate = PushedScreens()
        let id = UUID()
        gate.update(id, pushed: true)
        XCTAssertTrue(gate.hasPushed)
        gate.update(id, pushed: false)
        XCTAssertFalse(gate.hasPushed)
    }

    func testStackedScreensKeepItHiddenUntilAllAreGone() {
        let gate = PushedScreens()
        let first = UUID(), second = UUID()
        gate.update(first, pushed: true)
        gate.update(second, pushed: true)
        gate.update(first, pushed: false)
        XCTAssertTrue(gate.hasPushed)
        gate.update(second, pushed: false)
        XCTAssertFalse(gate.hasPushed)
    }

    func testRepeatedReportsDoNotPublishAgain() {
        let gate = PushedScreens()
        let id = UUID()
        var publishes = 0
        let token = gate.objectWillChange.sink { publishes += 1 }
        gate.update(id, pushed: true)
        gate.update(id, pushed: true)
        gate.update(id, pushed: false)
        gate.update(id, pushed: false)
        XCTAssertEqual(publishes, 2)
        token.cancel()
    }
}
