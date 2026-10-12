import Foundation

/// A song as returned by the server's song endpoints (`PATCH /songs/{id}` and friends).
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

    init(_ t: Track) {
        id = t.id; title = t.title; artist = t.artist; album = t.album; year = t.year; duration = t.duration
        tags = t.tags; bpm = t.bpm; source_url = t.sourceURL; wikipedia_song = t.wikipediaSong
        wikipedia_artist = t.wikipediaArtist
    }

    var track: Track {
        Track(id: id, title: title, artist: artist ?? "", duration: duration,
              thumbnail: cover != nil ? "/covers/\(id)" : nil, album: album, year: year, tags: tags, bpm: bpm,
              sourceURL: source_url, wikipediaSong: wikipedia_song, wikipediaArtist: wikipedia_artist)
    }
}

/// The server as a download pipe: its reachability and the songs now arriving on the phone.
/// The phone never lists the server's library; only the web UI does.
@MainActor
final class ServerLink: ObservableObject {
    struct Transfer { var track: Track; var progress: Double }

    @Published private(set) var reachable: Bool?
    @Published private(set) var checking = false
    @Published private(set) var transfers: [String: Transfer] = [:]
    @Published private(set) var failed: Set<String> = []

    func check(settings: Settings) async {
        guard !checking else { return }
        guard !settings.token.isEmpty || AuthService.shared.isSignedIn else { reachable = nil; return }
        checking = true
        defer { checking = false }
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).verify()
            reachable = true
        } catch { reachable = false }
    }

    func setReachable(_ value: Bool) { reachable = value }

    /// Copies a song that is on the server onto the phone; the Library shows it as "Downloading NN%" meanwhile.
    @discardableResult
    func download(_ track: Track, settings: Settings, into library: LibraryStore) async -> Bool {
        if library.contains(track.id) { return true }
        guard transfers[track.id] == nil else { return false }
        transfers[track.id] = Transfer(track: track, progress: 0)
        defer { transfers[track.id] = nil }
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).downloadFile(track) { [weak self] p in
                Task { @MainActor in self?.transfers[track.id]?.progress = p }
            }
            library.add(track)
            failed.remove(track.id)
            return true
        } catch {
            failed.insert(track.id)
            return false
        }
    }
}
