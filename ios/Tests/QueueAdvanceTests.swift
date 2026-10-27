import XCTest
@testable import AudioPlayer

final class QueueAdvanceTests: XCTestCase {
    private let ids = ["a", "b", "c"]

    private func cursor(_ index: Int, played: [String] = [], shuffle: Bool = false, repeatMode: PlaybackRepeat = .off) -> QueueCursor {
        QueueCursor(ids: ids, index: index, played: played, shuffle: shuffle, repeatMode: repeatMode)
    }

    private func next(_ c: QueueCursor, manual: Bool = true, pick: Int? = nil) -> AdvanceOutcome? {
        QueueAdvance.next(c, manual: manual) { candidates, _ in pick ?? candidates.first }
    }

    func testPlainOrderWalksTheQueueAndStopsAtTheEnd() {
        XCTAssertEqual(next(cursor(0))?.step, .load(1))
        XCTAssertEqual(next(cursor(1))?.step, .load(2))
        XCTAssertEqual(next(cursor(2))?.step, .pause)
    }

    func testRepeatAllWrapsToTheFirstSong() {
        XCTAssertEqual(next(cursor(2, repeatMode: .all))?.step, .load(0))
    }

    func testRepeatOneRestartsOnlyWhenTheSongEndsOnItsOwn() {
        let c = cursor(1, repeatMode: .one)
        XCTAssertEqual(next(c, manual: false), AdvanceOutcome(step: .restart, played: []))
        XCTAssertEqual(next(c, manual: true)?.step, .load(2))
    }

    func testAdvanceRecordsTheCurrentSongAsPlayed() {
        XCTAssertEqual(next(cursor(0))?.played, ["a"])
        XCTAssertEqual(next(cursor(1, played: ["a", "b"]))?.played, ["a", "b"])
    }

    func testNoCurrentSongIsNoOutcome() {
        XCTAssertNil(next(cursor(5)))
    }

    func testShuffleOffersOnlySongsNotYetPlayed() {
        var offered: [Int] = []
        let outcome = QueueAdvance.next(cursor(0, played: ["a"], shuffle: true), manual: true) { candidates, fresh in
            offered = candidates
            XCTAssertFalse(fresh)
            return candidates.last
        }
        XCTAssertEqual(offered, [1, 2])
        XCTAssertEqual(outcome, AdvanceOutcome(step: .load(2), played: ["a"]))
    }

    func testShuffleFallsBackToTheFirstCandidateWhenNothingIsPicked() {
        let outcome = QueueAdvance.next(cursor(0, shuffle: true), manual: true) { _, _ in nil }
        XCTAssertEqual(outcome?.step, .load(1))
    }

    func testShuffleRoundEndPausesWithoutRepeatAndKeepsPlayed() {
        let outcome = next(cursor(2, played: ["a", "b"], shuffle: true))
        XCTAssertEqual(outcome, AdvanceOutcome(step: .pause, played: ["a", "b"]))
    }

    func testShuffleRoundEndWithRepeatAllStartsAFreshRoundAwayFromTheCurrentSong() {
        var freshSeen = false
        var offered: [Int] = []
        let outcome = QueueAdvance.next(cursor(2, played: ["a", "b"], shuffle: true, repeatMode: .all), manual: true) { candidates, fresh in
            freshSeen = fresh
            offered = candidates
            return candidates.first
        }
        XCTAssertTrue(freshSeen)
        XCTAssertEqual(offered, [0, 1])
        XCTAssertEqual(outcome, AdvanceOutcome(step: .load(0), played: ["c"]))
    }

    func testShuffleRepeatAllWithOneSongRestartsIt() {
        let single = QueueCursor(ids: ["a"], index: 0, played: [], shuffle: true, repeatMode: .all)
        XCTAssertEqual(next(single), AdvanceOutcome(step: .restart, played: ["a"]))
    }

    func testPreviousRewindsPastThreeSeconds() {
        XCTAssertEqual(QueueAdvance.previous(cursor(1), position: 3.5, history: ["x"]), StepBackOutcome(step: .rewind, history: ["x"]))
    }

    func testPreviousStepsBackInPlainOrderAndRewindsAtTheStart() {
        XCTAssertEqual(QueueAdvance.previous(cursor(2), position: 1, history: []).step, .load(1))
        XCTAssertEqual(QueueAdvance.previous(cursor(0), position: 1, history: []).step, .rewind)
    }

    func testPreviousUnderShuffleFollowsHistoryAndSkipsStaleEntries() {
        let c = cursor(1, shuffle: true)
        XCTAssertEqual(QueueAdvance.previous(c, position: 0, history: ["c", "gone", "b"]), StepBackOutcome(step: .load(2), history: []))
        XCTAssertEqual(QueueAdvance.previous(c, position: 0, history: ["a", "gone"]), StepBackOutcome(step: .load(0), history: []))
        XCTAssertEqual(QueueAdvance.previous(c, position: 0, history: ["gone"]), StepBackOutcome(step: .rewind, history: []))
    }

    func testHasNext() {
        XCTAssertTrue(QueueAdvance.hasNext(cursor(1)))
        XCTAssertFalse(QueueAdvance.hasNext(cursor(2)))
        XCTAssertTrue(QueueAdvance.hasNext(cursor(2, repeatMode: .all)))
        XCTAssertTrue(QueueAdvance.hasNext(cursor(2, played: ["a"], shuffle: true)))
        XCTAssertFalse(QueueAdvance.hasNext(cursor(2, played: ["a", "b"], shuffle: true)))
    }

    func testMoveFollowsOnMoveSemantics() {
        let items = ["a", "b", "c", "d"]
        XCTAssertEqual(QueueEdit.moved(items, from: [0], to: 3), ["b", "c", "a", "d"])
        XCTAssertEqual(QueueEdit.moved(items, from: [3], to: 0), ["d", "a", "b", "c"])
        XCTAssertEqual(QueueEdit.moved(items, from: [0, 1], to: 4), ["c", "d", "a", "b"])
        XCTAssertEqual(QueueEdit.moved(items, from: [1], to: 1), items)
        XCTAssertEqual(QueueEdit.moved(items, from: [9], to: 0), items)
    }

    func testOrphansAreSongsQueuedOnlyThroughTheTag() {
        let queue = ["a", "b", "c", "d"]
        let via: [String: Set<String>] = ["a": ["rock"], "b": ["rock", "pop"], "c": ["rock"], "d": ["pop"]]
        let found = QueueEdit.orphans(ids: queue, viaTags: via, key: "rock", manual: ["c"], current: nil)
        XCTAssertEqual(found, [0])
        XCTAssertEqual(QueueEdit.orphans(ids: queue, viaTags: via, key: "rock", manual: [], current: "a"), [2])
    }
}
