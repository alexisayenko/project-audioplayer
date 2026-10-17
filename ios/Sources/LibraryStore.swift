import Foundation

/// The catalog on this iPhone: every song the server lists (cached for offline use) plus the songs whose audio is stored here.
/// A song is "on the phone" when its file exists in `Documents/audio`; that is never written to `library.json`.
@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var songs: [Track] = []
    @Published private(set) var phoneIDs: Set<String> = []
    /// ETag of the last catalog the server sent, for `If-None-Match`.
    private(set) var etag: String?

    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let audioDirectory = documents.appendingPathComponent("audio", isDirectory: true)
    private static let indexURL = documents.appendingPathComponent("library.json")

    private struct Stored: Codable {
        var etag: String?
        var songs: [Track]
    }

    /// Songs whose audio is on this iPhone.
    var tracks: [Track] { songs.filter { phoneIDs.contains($0.id) } }

    init() {
        try? FileManager.default.createDirectory(at: Self.audioDirectory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: Self.indexURL) {
            if let stored = try? JSONDecoder().decode(Stored.self, from: data) {
                songs = stored.songs
                etag = stored.etag
            } else if let legacy = try? JSONDecoder().decode([Track].self, from: data) {
                songs = legacy
            }
            var changed = false
            for i in songs.indices {
                let clean = CoverURL.scrubbed(songs[i].thumbnail)
                if clean != songs[i].thumbnail { songs[i].thumbnail = clean; changed = true }
            }
            phoneIDs = Set(songs.filter { FileManager.default.fileExists(atPath: $0.fileURL.path) }.map(\.id))
            if changed { save() }
        }
    }

    func contains(_ id: String) -> Bool { phoneIDs.contains(id) }

    /// A song whose file has just arrived on the phone.
    func add(_ track: Track) {
        var t = track
        if let i = songs.firstIndex(where: { $0.id == t.id }) {
            t.addedAt = t.addedAt ?? songs[i].addedAt
            t.sources = t.sources ?? songs[i].sources
            t.localOnly = songs[i].localOnly
            t.onServer = songs[i].localOnly == true ? false : true
            songs[i] = t
        } else {
            t.addedAt = t.addedAt ?? Date()
            t.onServer = true
            songs.insert(t, at: 0)
        }
        phoneIDs.insert(t.id)
        save()
    }

    func update(_ track: Track) {
        guard let i = songs.firstIndex(where: { $0.id == track.id }) else { return }
        var merged = track
        merged.thumbnail = track.thumbnail ?? songs[i].thumbnail
        merged.addedAt = track.addedAt ?? songs[i].addedAt
        merged.sources = track.sources ?? songs[i].sources
        merged.onServer = track.onServer ?? songs[i].onServer
        merged.localOnly = songs[i].localOnly
        songs[i] = merged
        save()
    }

    func setThumbnail(_ id: String, _ value: String?) {
        guard let i = songs.firstIndex(where: { $0.id == id }) else { return }
        songs[i].thumbnail = value
        save()
        NotificationCenter.default.post(name: .trackThumbnailChanged, object: nil, userInfo: ["id": id, "thumbnail": value as Any])
    }

    /// Removes the audio from the phone. The song stays listed unless the server no longer knows it.
    func removeAudio(_ id: String) {
        guard let i = songs.firstIndex(where: { $0.id == id }) else { return }
        try? FileManager.default.removeItem(at: songs[i].fileURL)
        phoneIDs.remove(id)
        if songs[i].localOnly == true { songs.remove(at: i) }
        save()
    }

    /// Removes every phone copy except songs the server no longer lists (those would be lost for good).
    @discardableResult
    func removeAllAudio() -> Int {
        let ids = songs.filter { phoneIDs.contains($0.id) && $0.localOnly != true }.map(\.id)
        for id in ids { removeAudio(id) }
        return ids.count
    }

    /// Removes the song everywhere on the phone: entry and file.
    func delete(_ id: String) {
        if let t = songs.first(where: { $0.id == id }) { try? FileManager.default.removeItem(at: t.fileURL) }
        songs.removeAll { $0.id == id }
        phoneIDs.remove(id)
        save()
    }

    /// Merges the server's catalog, keeping each song's phone state. Songs the server forgot are dropped only when
    /// they have no audio here; otherwise they stay as local-only. Returns the songs that appeared since the last sync
    /// (empty on the first sync, which is only a baseline).
    @discardableResult
    func merge(_ catalog: CatalogResponse, etag newTag: String?) -> [Track] {
        let hadCatalog = etag != nil
        let old = Dictionary(songs.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let ids = Set(catalog.ids)
        var result: [Track] = []
        var seen = Set<String>()
        var appeared: [Track] = []
        for s in catalog.songs where seen.insert(s.id).inserted {
            var t = s.track
            if let prev = old[s.id] {
                t.addedAt = t.addedAt ?? prev.addedAt
                t.thumbnail = t.thumbnail ?? prev.thumbnail
            } else if hadCatalog, t.onServer == true {
                appeared.append(t)
            }
            result.append(t)
        }
        for prev in songs where !seen.contains(prev.id) {
            if ids.contains(prev.id) {
                result.append(prev)
            } else if phoneIDs.contains(prev.id) {
                var t = prev
                t.localOnly = true
                t.onServer = false
                result.append(t)
            }
        }
        songs = result
        phoneIDs = phoneIDs.intersection(Set(result.map(\.id)))
        etag = newTag ?? "synced"
        save()
        return appeared.filter { !phoneIDs.contains($0.id) }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(Stored(etag: etag, songs: songs)) {
            try? data.write(to: Self.indexURL, options: .atomic)
        }
    }
}

extension Notification.Name {
    static let trackThumbnailChanged = Notification.Name("trackThumbnailChanged")
}
