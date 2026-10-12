import Foundation

/// Persists the list of downloaded tracks as JSON next to the audio files.
@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var tracks: [Track] = []

    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let audioDirectory = documents.appendingPathComponent("audio", isDirectory: true)
    private static let indexURL = documents.appendingPathComponent("library.json")

    init() {
        try? FileManager.default.createDirectory(at: Self.audioDirectory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: Self.indexURL),
           let decoded = try? JSONDecoder().decode([Track].self, from: data) {
            tracks = decoded
            var changed = false
            for i in tracks.indices {
                let clean = CoverURL.scrubbed(tracks[i].thumbnail)
                if clean != tracks[i].thumbnail { tracks[i].thumbnail = clean; changed = true }
            }
            if changed { save() }
        }
    }

    func contains(_ id: String) -> Bool { tracks.contains { $0.id == id } }

    func add(_ track: Track) {
        var track = track
        track.addedAt = tracks.first { $0.id == track.id }?.addedAt ?? track.addedAt ?? Date()
        tracks.removeAll { $0.id == track.id }
        tracks.insert(track, at: 0)
        save()
    }

    func update(_ track: Track) {
        guard let i = tracks.firstIndex(where: { $0.id == track.id }) else { return }
        var merged = track
        merged.thumbnail = track.thumbnail ?? tracks[i].thumbnail
        merged.addedAt = track.addedAt ?? tracks[i].addedAt
        tracks[i] = merged
        save()
    }

    func remove(_ id: String) {
        guard let i = tracks.firstIndex(where: { $0.id == id }) else { return }
        remove(at: IndexSet(integer: i))
    }

    func remove(at offsets: IndexSet) {
        for index in offsets {
            try? FileManager.default.removeItem(at: tracks[index].fileURL)
        }
        tracks.remove(atOffsets: offsets)
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(tracks) {
            try? data.write(to: Self.indexURL, options: .atomic)
        }
    }
}
