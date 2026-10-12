import Foundation

/// A song as returned by the server's `GET /library`.
struct ServerSong: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var artist: String?
    var album: String?
    var year: Int?
    var duration: Double?
    var cover: String?
    var tags: [String]?
    var bpm: Double?
    var source_url: String?
    var wikipedia_song: String?
    var wikipedia_artist: String?
    var added_at: String?

    init(id: String, title: String, artist: String? = nil, album: String? = nil, year: Int? = nil,
         duration: Double? = nil, cover: String? = nil, tags: [String]? = nil, bpm: Double? = nil,
         source_url: String? = nil, wikipedia_song: String? = nil, wikipedia_artist: String? = nil,
         added_at: String? = nil) {
        self.id = id; self.title = title; self.artist = artist; self.album = album; self.year = year
        self.duration = duration; self.cover = cover; self.tags = tags; self.bpm = bpm
        self.source_url = source_url; self.wikipedia_song = wikipedia_song
        self.wikipedia_artist = wikipedia_artist; self.added_at = added_at
    }

    init(_ t: Track) {
        self.init(id: t.id, title: t.title, artist: t.artist, album: t.album, year: t.year, duration: t.duration,
                  tags: t.tags, bpm: t.bpm, source_url: t.sourceURL, wikipedia_song: t.wikipediaSong,
                  wikipedia_artist: t.wikipediaArtist)
    }

    var track: Track {
        Track(id: id, title: title, artist: artist ?? "", duration: duration,
              thumbnail: cover != nil ? "/covers/\(id)" : nil, album: album, year: year, tags: tags, bpm: bpm,
              sourceURL: source_url, wikipediaSong: wikipedia_song, wikipediaArtist: wikipedia_artist)
    }
}

struct ServerLibraryResponse: Codable { let songs: [ServerSong] }

/// The server's song list, cached on disk so it still shows offline.
@MainActor
final class ServerLibrary: ObservableObject {
    @Published private(set) var songs: [ServerSong] = []
    @Published private(set) var reachable: Bool?
    @Published private(set) var refreshing = false
    @Published private(set) var downloading: Set<String> = []
    @Published private(set) var failed: Set<String> = []
    @Published private(set) var batch: (done: Int, total: Int)?

    private static let cacheURL = LibraryStore.documents.appendingPathComponent("server-library.json")

    init() {
        if let data = try? Data(contentsOf: Self.cacheURL),
           let cached = try? JSONDecoder().decode([ServerSong].self, from: data) {
            songs = cached
        }
    }

    func refresh(settings: Settings) async {
        guard !refreshing, !settings.token.isEmpty else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let fresh = try await APIClient(baseURL: settings.serverURL, token: settings.token).library()
            songs = fresh
            reachable = true
            persist()
        } catch {
            reachable = false
        }
    }

    func apply(_ song: ServerSong) {
        if let i = songs.firstIndex(where: { $0.id == song.id }) { songs[i] = song } else { songs.insert(song, at: 0) }
        persist()
    }

    func forget(_ id: String) {
        songs.removeAll { $0.id == id }
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(songs) { try? data.write(to: Self.cacheURL, options: .atomic) }
    }

    @discardableResult
    func download(_ track: Track, settings: Settings, into library: LibraryStore) async -> Bool {
        if library.contains(track.id) { return true }
        guard !downloading.contains(track.id) else { return false }
        downloading.insert(track.id)
        defer { downloading.remove(track.id) }
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).downloadFile(track)
            library.add(track)
            failed.remove(track.id)
            return true
        } catch {
            failed.insert(track.id)
            return false
        }
    }

    func downloadAll(_ tracks: [Track], settings: Settings, into library: LibraryStore) async {
        guard batch == nil else { return }
        let todo = tracks.filter { !library.contains($0.id) }
        guard !todo.isEmpty else { return }
        batch = (0, todo.count)
        for (i, t) in todo.enumerated() {
            await download(t, settings: settings, into: library)
            batch = (i + 1, todo.count)
        }
        batch = nil
    }
}
