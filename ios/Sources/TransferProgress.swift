import Foundation

/// The percent of each download that is running, kept apart from `ServerLink` so that a progress tick wakes only the views
/// that show the percent. Everything that watches `ServerLink` (the hidden tabs included) used to rebuild on every tick.
@MainActor
final class TransferProgress: ObservableObject {
    @Published private(set) var values: [String: Double] = [:]

    func set(_ id: String, _ value: Double) {
        if values[id] != value { values[id] = value }
    }

    func clear(_ id: String) {
        if values[id] != nil { values[id] = nil }
    }

    func clear(_ ids: [String]) {
        for id in ids { clear(id) }
    }
}
