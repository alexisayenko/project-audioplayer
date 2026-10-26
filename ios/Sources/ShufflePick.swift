import Foundation

/// Shuffle that favours less-played songs (IOS-105), the rules of `web/js/shuffle-pick.js` (PLY-178): the round order is the
/// songs shuffled, then stable-sorted by their recent play count `n`, so the lowest tier plays first and each tier is random.
enum ShufflePick {
    static let minLocalPlay = 5.0
    static let window: TimeInterval = 30 * 86_400

    /// Plays not yet flushed to the server that count as one play each: at least 5 s and not older than 30 days.
    static func localCounts(_ plays: [PlayRecord], now: Date = Date()) -> [String: Int] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        var out: [String: Int] = [:]
        for play in plays where play.listened >= minLocalPlay {
            guard let at = formatter.date(from: play.timestamp) ?? plain.date(from: play.timestamp),
                  now.timeIntervalSince(at) <= window else { continue }
            out[play.songID, default: 0] += 1
        }
        return out
    }

    static func merged(_ server: [String: Int], _ local: [String: Int]) -> [String: Int] {
        server.merging(local) { $0 + $1 }
    }

    /// Fisher-Yates, then a stable sort by count when counts are known; the song just played is not put first again.
    static func order<G: RandomNumberGenerator>(_ ids: [String], counts: [String: Int]?, last: String? = nil,
                                                using rng: inout G) -> [String] {
        var order = ids
        if order.count > 1 {
            for i in stride(from: order.count - 1, to: 0, by: -1) { order.swapAt(i, Int.random(in: 0...i, using: &rng)) }
        }
        if let counts {
            let keyed = order.enumerated().map { (id: $0.element, at: $0.offset, n: counts[$0.element] ?? 0) }
            order = keyed.sorted { $0.n != $1.n ? $0.n < $1.n : $0.at < $1.at }.map(\.id)
        }
        if let last, order.count > 1, order[0] == last { order.swapAt(0, 1) }
        return order
    }

    /// The index in `ids` of a song from the lowest-count tier, chosen at random: where "Play all" starts under shuffle.
    static func firstIndex<G: RandomNumberGenerator>(_ ids: [String], counts: [String: Int]?, using rng: inout G) -> Int? {
        guard let first = order(ids, counts: counts, using: &rng).first else { return nil }
        return ids.firstIndex(of: first)
    }

    /// Of the candidate positions in `ids`, the one ranked best in `rank`.
    static func best(_ candidates: [Int], ids: [String], rank: [String: Int]) -> Int? {
        candidates.min { (rank[ids[$0]] ?? Int.max) < (rank[ids[$1]] ?? Int.max) }
    }
}

/// Keeps the round order between Next presses: rebuilt when the queue changes, when asked for a fresh round, and when counts
/// first arrive after an unweighted start; not after each play.
struct ShuffleRanker {
    private var signature: String?
    private var rank: [String: Int] = [:]
    private var weighted = false

    mutating func rank<G: RandomNumberGenerator>(ids: [String], counts: [String: Int]?, fresh: Bool = false,
                                                last: String? = nil, using rng: inout G) -> [String: Int] {
        let sig = ids.joined(separator: "\u{0}")
        if !fresh, signature == sig, weighted || counts == nil { return rank }
        signature = sig
        weighted = counts != nil
        var built: [String: Int] = [:]
        for (i, id) in ShufflePick.order(ids, counts: counts, last: last, using: &rng).enumerated() where built[id] == nil { built[id] = i }
        rank = built
        return built
    }
}
