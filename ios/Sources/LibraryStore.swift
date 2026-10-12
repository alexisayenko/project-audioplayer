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
        }
    }

    func contains(_ id: String) -> Bool { tracks.contains { $0.id == id } }

    func add(_ track: Track) {
        tracks.removeAll { $0.id == track.id }
        tracks.insert(track, at: 0)
        save()
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
