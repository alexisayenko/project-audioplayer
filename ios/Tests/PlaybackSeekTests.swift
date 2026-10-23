import XCTest
@testable import AudioPlayer

final class PlaybackSeekTests: XCTestCase {
    func testTapSkipsFiveSecondsTowardTappedSide() {
        XCTAssertEqual(PlaybackSeek.tapTarget(current: 50, duration: 200, tapped: 20), 45)
        XCTAssertEqual(PlaybackSeek.tapTarget(current: 50, duration: 200, tapped: 80), 55)
        XCTAssertNil(PlaybackSeek.tapTarget(current: 50, duration: 200, tapped: 50))
    }

    func testTapSkipClampsAtSongBounds() {
        XCTAssertEqual(PlaybackSeek.tapTarget(current: 3, duration: 200, tapped: 0), 0)
        XCTAssertEqual(PlaybackSeek.tapTarget(current: 198, duration: 200, tapped: 200), 200)
    }

    func testInvalidDurationOrPositionDoesNotSeek() {
        XCTAssertNil(PlaybackSeek.tapTarget(current: 2, duration: 0, tapped: 0))
        XCTAssertNil(PlaybackSeek.tapTarget(current: 2, duration: 30, tapped: .infinity))
    }
}
