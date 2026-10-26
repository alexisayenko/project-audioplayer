import XCTest
@testable import AudioPlayer

final class PlaybackResumeTests: XCTestCase {
    func testPositionAboveThreeSecondsResumes() {
        XCTAssertEqual(ResumePosition.start(saved: 42.5, duration: 200), 42.5)
    }

    func testPositionAtOrBelowThreeSecondsStartsAtZero() {
        XCTAssertEqual(ResumePosition.start(saved: 3, duration: 200), 0)
        XCTAssertEqual(ResumePosition.start(saved: 0, duration: 200), 0)
        XCTAssertEqual(ResumePosition.start(saved: -4, duration: 200), 0)
    }

    func testPositionWithinFiveSecondsOfTheEndStartsAtZero() {
        XCTAssertEqual(ResumePosition.start(saved: 196, duration: 200), 0)
        XCTAssertEqual(ResumePosition.start(saved: 195, duration: 200), 195)
    }

    func testUnknownDurationStillResumes() {
        XCTAssertEqual(ResumePosition.start(saved: 30, duration: nil), 30)
        XCTAssertEqual(ResumePosition.start(saved: 30, duration: 0), 30)
    }

    func testMissingOrInvalidPositionStartsAtZero() {
        XCTAssertEqual(ResumePosition.start(saved: nil, duration: 200), 0)
        XCTAssertEqual(ResumePosition.start(saved: .nan, duration: 200), 0)
        XCTAssertEqual(ResumePosition.start(saved: .infinity, duration: 200), 0)
    }

    func testCheckpointWritesAtMostEveryFiveSecondsWhilePlaying() {
        var checkpoint = ResumeCheckpoint()
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertTrue(checkpoint.due(now: start, playing: true))
        XCTAssertFalse(checkpoint.due(now: start.addingTimeInterval(0.5), playing: true))
        XCTAssertFalse(checkpoint.due(now: start.addingTimeInterval(4.9), playing: true))
        XCTAssertTrue(checkpoint.due(now: start.addingTimeInterval(5), playing: true))
        XCTAssertFalse(checkpoint.due(now: start.addingTimeInterval(7), playing: true))
    }

    func testCheckpointWritesAtOnceWhenNotPlaying() {
        var checkpoint = ResumeCheckpoint()
        let start = Date(timeIntervalSince1970: 1000)
        XCTAssertTrue(checkpoint.due(now: start, playing: true))
        XCTAssertTrue(checkpoint.due(now: start.addingTimeInterval(1), playing: false))
        XCTAssertTrue(checkpoint.due(now: start.addingTimeInterval(1.1), playing: false))
    }

    func testSavedQueueWithoutPositionStillDecodes() throws {
        let old = Data(#"{"ids":["a","b"],"index":1,"tags":["house"]}"#.utf8)
        let saved = try JSONDecoder().decode(SavedPlayback.self, from: old)
        XCTAssertEqual(saved, SavedPlayback(ids: ["a", "b"], index: 1, tags: ["house"], position: nil))
    }

    func testSavedQueueRoundTripsThePosition() throws {
        let saved = SavedPlayback(ids: ["a"], index: 0, tags: [], position: 61.5)
        let back = try JSONDecoder().decode(SavedPlayback.self, from: JSONEncoder().encode(saved))
        XCTAssertEqual(back, saved)
    }

    @MainActor
    func testPersistenceReadsWhatWasWritten() throws {
        let suite = "PlaybackResumeTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let persistence = PlaybackPersistence(defaults: defaults)
        XCTAssertNil(persistence.saved())
        let saved = SavedPlayback(ids: ["x", "y"], index: 1, tags: ["a"], position: 12)
        defaults.set(try JSONEncoder().encode(saved), forKey: PlaybackPersistence.key)
        XCTAssertEqual(persistence.saved(), saved)
    }
}
