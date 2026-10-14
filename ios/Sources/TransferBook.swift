import Foundation

struct Transfer {
    var track: Track
    var progress: Double
    var generation: Int
}

struct TransferBook {
    private(set) var items: [String: Transfer] = [:]
    private var counter = 0

    func contains(_ id: String) -> Bool { items[id] != nil }

    @discardableResult
    mutating func start(_ track: Track) -> Int {
        counter += 1
        items[track.id] = Transfer(track: track, progress: 0, generation: counter)
        return counter
    }

    func generation(_ id: String) -> Int? { items[id]?.generation }

    mutating func setProgress(_ id: String, generation: Int?, _ value: Double) {
        guard let generation, items[id]?.generation == generation else { return }
        items[id]?.progress = value
    }

    mutating func finish(_ id: String) { items[id] = nil }

    mutating func finish(_ id: String, generation: Int) {
        if items[id]?.generation == generation { items[id] = nil }
    }

    /// Drops every transfer whose song is already on the phone; returns the ids dropped.
    @discardableResult
    mutating func reconcile(onPhone: (String) -> Bool) -> [String] {
        let done = items.keys.filter(onPhone)
        for id in done { items[id] = nil }
        return done
    }
}
