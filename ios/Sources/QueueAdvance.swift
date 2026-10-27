import Foundation

enum PlaybackRepeat: String {
    case off, all, one

    var next: PlaybackRepeat {
        switch self {
        case .off: return .all
        case .all: return .one
        case .one: return .off
        }
    }

    var spokenName: String {
        switch self {
        case .off: return "off"
        case .all: return "whole list"
        case .one: return "one song"
        }
    }
}

/// What the player does after an advance or a step back.
enum QueueStep: Equatable {
    case restart
    case rewind
    case pause
    case load(Int)
}

/// The queue as the advance rules see it: song ids in queue order, the playing position, the songs already played this round.
struct QueueCursor {
    let ids: [String]
    let index: Int
    let played: [String]
    let shuffle: Bool
    let repeatMode: PlaybackRepeat

    var currentID: String? { ids.indices.contains(index) ? ids[index] : nil }
}

struct AdvanceOutcome: Equatable {
    var step: QueueStep
    var played: [String]
}

struct StepBackOutcome: Equatable {
    var step: QueueStep
    var history: [String]
}

/// The rules for Next, Previous and "is there a next song", apart from AVPlayer: pure, so they run in unit tests.
enum QueueAdvance {
    /// `pick` chooses among the candidate positions; `fresh` says a new shuffle round starts.
    static func next(_ cursor: QueueCursor, manual: Bool, pick: (_ candidates: [Int], _ fresh: Bool) -> Int?) -> AdvanceOutcome? {
        guard let current = cursor.currentID else { return nil }
        let index = cursor.index
        if cursor.repeatMode == .one && !manual { return AdvanceOutcome(step: .restart, played: cursor.played) }
        var seen = cursor.played.contains(current) ? cursor.played : cursor.played + [current]
        guard cursor.shuffle else {
            let step: QueueStep
            if index + 1 < cursor.ids.count { step = .load(index + 1) }
            else if cursor.repeatMode == .all { step = .load(0) }
            else { step = .pause }
            return AdvanceOutcome(step: step, played: seen)
        }
        var candidates = cursor.ids.indices.filter { !seen.contains(cursor.ids[$0]) }
        var fresh = false
        if candidates.isEmpty {
            guard cursor.repeatMode == .all else { return AdvanceOutcome(step: .pause, played: cursor.played) }
            seen = [current]
            fresh = true
            candidates = cursor.ids.indices.filter { $0 != index }
            if candidates.isEmpty { return AdvanceOutcome(step: .restart, played: seen) }
        }
        return AdvanceOutcome(step: .load(pick(candidates, fresh) ?? candidates[0]), played: seen)
    }

    static func previous(_ cursor: QueueCursor, position: Double, history: [String]) -> StepBackOutcome {
        if position > 3 { return StepBackOutcome(step: .rewind, history: history) }
        if cursor.shuffle {
            var rest = history
            while let id = rest.popLast() {
                if let at = cursor.ids.firstIndex(of: id), at != cursor.index { return StepBackOutcome(step: .load(at), history: rest) }
            }
            return StepBackOutcome(step: .rewind, history: rest)
        }
        return StepBackOutcome(step: cursor.index == 0 ? .rewind : .load(cursor.index - 1), history: history)
    }

    static func hasNext(_ cursor: QueueCursor) -> Bool {
        if cursor.repeatMode == .all { return !cursor.ids.isEmpty }
        if cursor.shuffle { return cursor.ids.contains { !cursor.played.contains($0) && $0 != cursor.currentID } }
        return cursor.index + 1 < cursor.ids.count
    }
}

/// Queue edits that do not need the player.
enum QueueEdit {
    /// `onMove` semantics: `to` is an insertion offset in the old order.
    static func moved<T>(_ items: [T], from: IndexSet, to: Int) -> [T] {
        let source = from.filter { items.indices.contains($0) }.sorted()
        guard !source.isEmpty else { return items }
        let picked = source.map { items[$0] }
        var rest = items
        for i in source.reversed() { rest.remove(at: i) }
        let target = min(max(to - source.filter { $0 < to }.count, 0), rest.count)
        rest.insert(contentsOf: picked, at: target)
        return rest
    }

    /// Positions of songs that were queued only through `key` (a lower-case tag) and may leave with it.
    static func orphans(ids: [String], viaTags: [String: Set<String>], key: String, manual: Set<String>, current: String?) -> [Int] {
        ids.indices.filter { i in
            let id = ids[i]
            guard let tags = viaTags[id], tags.contains(key), !manual.contains(id), id != current else { return false }
            return tags.subtracting([key]).isEmpty
        }
    }
}
