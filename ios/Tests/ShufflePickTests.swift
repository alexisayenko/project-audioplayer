import XCTest
@testable import AudioPlayer

private struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

final class ShufflePickTests: XCTestCase {
    private let ids = ["a", "b", "c", "d", "e", "f"]

    func testOrderIsAPermutation() {
        var rng = SeededGenerator(state: 1)
        let order = ShufflePick.order(ids, counts: nil, using: &rng)
        XCTAssertEqual(order.sorted(), ids)
    }

    func testLessPlayedSongsComeFirst() {
        let counts = ["a": 3, "b": 0, "c": 1, "d": 0, "e": 3, "f": 1]
        for seed in 1...20 {
            var rng = SeededGenerator(state: UInt64(seed))
            let order = ShufflePick.order(ids, counts: counts, using: &rng)
            let tiers = order.map { counts[$0] ?? 0 }
            XCTAssertEqual(tiers, tiers.sorted(), "seed \(seed)")
        }
    }

    func testSongsWithoutACountAreTheLowestTier() {
        var rng = SeededGenerator(state: 7)
        let order = ShufflePick.order(ids, counts: ["a": 2, "b": 2, "c": 2], using: &rng)
        XCTAssertEqual(Set(order.prefix(3)), ["d", "e", "f"])
    }

    func testTiesAreShuffledNotFixed() {
        let counts = Dictionary(uniqueKeysWithValues: ids.map { ($0, 0) })
        var firsts = Set<String>()
        for seed in 1...40 {
            var rng = SeededGenerator(state: UInt64(seed))
            firsts.insert(ShufflePick.order(ids, counts: counts, using: &rng)[0])
        }
        XCTAssertGreaterThan(firsts.count, 2)
    }

    func testNoCountsIsUniformNotSorted() {
        var seen = Set<[String]>()
        for seed in 1...10 {
            var rng = SeededGenerator(state: UInt64(seed))
            seen.insert(ShufflePick.order(ids, counts: nil, using: &rng))
        }
        XCTAssertGreaterThan(seen.count, 1)
    }

    func testTheSongJustPlayedIsNotFirstAgain() {
        for seed in 1...30 {
            var rng = SeededGenerator(state: UInt64(seed))
            let order = ShufflePick.order(ids, counts: Dictionary(uniqueKeysWithValues: ids.map { ($0, 0) }), last: "a", using: &rng)
            XCTAssertNotEqual(order[0], "a", "seed \(seed)")
        }
    }

    func testFirstIndexIsFromTheLowestTier() {
        let counts = ["a": 5, "b": 5, "c": 0, "d": 5, "e": 5, "f": 5]
        for seed in 1...10 {
            var rng = SeededGenerator(state: UInt64(seed))
            XCTAssertEqual(ShufflePick.firstIndex(ids, counts: counts, using: &rng), 2)
        }
        var rng = SeededGenerator(state: 1)
        XCTAssertNil(ShufflePick.firstIndex([], counts: nil, using: &rng))
    }

    func testBestPicksTheLowestRankedCandidate() {
        let rank = ["a": 4, "b": 0, "c": 2, "d": 1, "e": 3, "f": 5]
        XCTAssertEqual(ShufflePick.best([0, 2, 4], ids: ids, rank: rank), 2)
        XCTAssertEqual(ShufflePick.best([1, 3], ids: ids, rank: rank), 1)
        XCTAssertNil(ShufflePick.best([], ids: ids, rank: rank))
    }

    func testRoundPlaysTiersInOrderUnderRepeatedNext() {
        let counts = ["a": 2, "b": 0, "c": 1, "d": 0, "e": 2, "f": 1]
        var rng = SeededGenerator(state: 3)
        var ranker = ShuffleRanker()
        var left = Array(ids.indices)
        var tiers: [Int] = []
        while !left.isEmpty {
            let rank = ranker.rank(ids: ids, counts: counts, using: &rng)
            let pick = ShufflePick.best(left, ids: ids, rank: rank)!
            tiers.append(counts[ids[pick]] ?? 0)
            left.removeAll { $0 == pick }
        }
        XCTAssertEqual(tiers, [0, 0, 1, 1, 2, 2])
    }

    func testRankerKeepsTheRoundOrderUntilTheQueueChanges() {
        var rng = SeededGenerator(state: 9)
        var ranker = ShuffleRanker()
        let counts = ["a": 0]
        let first = ranker.rank(ids: ids, counts: counts, using: &rng)
        XCTAssertEqual(ranker.rank(ids: ids, counts: counts, using: &rng), first)
        XCTAssertEqual(ranker.rank(ids: ids, counts: ["a": 9], using: &rng), first)
        let changed = ranker.rank(ids: ids + ["g"], counts: counts, using: &rng)
        XCTAssertEqual(changed.count, 7)
    }

    func testRankerRebuildsWhenCountsFirstArrive() {
        var rng = SeededGenerator(state: 5)
        var ranker = ShuffleRanker()
        _ = ranker.rank(ids: ids, counts: nil, using: &rng)
        let weighted = ranker.rank(ids: ids, counts: ["a": 4, "b": 4, "c": 4, "d": 4, "e": 4], using: &rng)
        XCTAssertEqual(weighted["f"], 0)
    }

    func testFreshRoundRebuilds() {
        let counts = ["a": 1]
        var ranker = ShuffleRanker()
        var seen = Set<[String: Int]>()
        for seed in 1...10 {
            var rng = SeededGenerator(state: UInt64(seed))
            seen.insert(ranker.rank(ids: ids, counts: counts, fresh: true, using: &rng))
        }
        XCTAssertGreaterThan(seen.count, 1)
    }

    func testServerCountsReadTheThirtyDayWindow() throws {
        let json = Data(#"{"a":{"listened":{"all":9,"d30":2},"skipped":{"all":4,"d30":1}},"b":{"listened":{"all":3}}}"#.utf8)
        let entries = try JSONDecoder().decode([String: LibraryListeningEntry].self, from: json)
        XCTAssertEqual(ListeningStore.recentCounts(entries), ["a": 3, "b": 0])
    }

    func testLocalCountsTakeRecentPlaysOfAtLeastFiveSeconds() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let stamp = { (age: TimeInterval) in ISO8601DateFormatter().string(from: now.addingTimeInterval(-age)) }
        let plays = [
            PlayRecord(timestamp: stamp(60), songID: "a", listened: 30),
            PlayRecord(timestamp: stamp(120), songID: "a", listened: 5),
            PlayRecord(timestamp: stamp(60), songID: "b", listened: 4.9),
            PlayRecord(timestamp: stamp(31 * 86_400), songID: "c", listened: 90),
            PlayRecord(timestamp: "not a date", songID: "d", listened: 90),
        ]
        XCTAssertEqual(ShufflePick.localCounts(plays, now: now), ["a": 2])
    }

    func testMergeAddsLocalToServerCounts() {
        XCTAssertEqual(ShufflePick.merged(["a": 1, "b": 0], ["a": 2, "c": 1]), ["a": 3, "b": 0, "c": 1])
    }
}
