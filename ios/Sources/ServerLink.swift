import Foundation
import os

private let transferLog = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.alexisayenko.audioplayer", category: "transfer")

/// A song as returned by the server's song endpoints (`PATCH /songs/{id}` and friends).
struct ServerSong: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var artist: String?
    var album: String?
    var remixer: String?
    var year: Int?
    var duration: Double?
    var cover: String?
    var tags: [String]?
    var bpm: Double?
    var source_url: String?
    var wikipedia_song: String?
    var wikipedia_artist: String?
    var musicbrainz_url: String?
    var added_at: String?
    var audio_state: String?
    var sources: [SongSource]?
    var version: SongVersion?
    var mainArtists: [String]?
    var featuredArtists: [String]?
    var withArtists: [String]?
    var releaseYear: Int?
    var albums: [String]?
    var genres: [String]?
    var remix_year: Int?
    var rawTitle: String?
    var wikipedia_album: String?
    var discogs_url: String?

    init(_ t: Track) {
        id = t.id; title = t.title; artist = t.artist; album = t.album; remixer = t.remixer; year = t.year; duration = t.duration
        tags = t.tags; bpm = t.bpm; source_url = t.sourceURL; wikipedia_song = t.wikipediaSong
        wikipedia_artist = t.wikipediaArtist; musicbrainz_url = t.musicbrainzURL; sources = t.sources
        version = t.version; mainArtists = t.mainArtists; featuredArtists = t.featuredArtists; withArtists = t.withArtists
        releaseYear = t.releaseYear; albums = t.albums; genres = t.genres; remix_year = t.remixYear; rawTitle = t.rawTitle
        wikipedia_album = t.wikipediaAlbum; discogs_url = t.discogsURL
    }

    var track: Track {
        Track(id: id, title: title, artist: artist ?? "", duration: duration,
              thumbnail: cover != nil ? "/covers/\(id)" : nil, album: album, remixer: remixer, year: year, tags: tags, bpm: bpm,
              sourceURL: source_url, wikipediaSong: wikipedia_song, wikipediaArtist: wikipedia_artist, musicbrainzURL: musicbrainz_url,
              addedAt: added_at.flatMap(Self.parseDate), sources: sources, onServer: audio_state.map { $0 == "server" },
              version: version, mainArtists: mainArtists, featuredArtists: featuredArtists, withArtists: withArtists,
              releaseYear: releaseYear, albums: albums, genres: genres, remixYear: remix_year, rawTitle: rawTitle,
              wikipediaAlbum: wikipedia_album, discogsURL: discogs_url)
    }

    private static func parseDate(_ s: String) -> Date? { ISO8601DateFormatter().date(from: s) }
}

/// The server link: its reachability, the catalog sync and the songs now arriving on the phone.
@MainActor
final class ServerLink: ObservableObject {
    @Published private(set) var reachable: Bool?
    @Published private(set) var checking = false
    /// The server answered 403: signed in, but this account isn't allowed. Cleared by the next successful request.
    @Published private(set) var forbidden = false
    /// The server answered 401: it is reachable but did not accept the stored sign-in. Cleared by the next successful request.
    @Published private(set) var unauthorized = false
    /// What the last failed request really was, in words for the person. Nil while requests succeed.
    @Published private(set) var failureMessage: String?
    @Published private var book = TransferBook()
    var transfers: [String: Transfer] { book.items }
    @Published private(set) var failed: Set<String> = []
    /// A failure to tell the person about once (Library shows it as a toast).
    @Published var notice: String?
    private var copyError: String?
    @Published private(set) var syncing = false
    /// True once a catalog has been fetched (or confirmed unchanged) since launch.
    @Published private(set) var synced = false
    private var autoRunning = false

    static func hasCredentials(_ settings: Settings) -> Bool {
        !settings.token.isEmpty || AuthService.shared.isSignedIn
    }

    /// Fetches the catalog with the stored ETag and merges it. Failures are quiet: the status LED turns off and the cached catalog stays.
    func syncCatalog(settings: Settings, library: LibraryStore, auto: Bool = true) async {
        guard !syncing, Self.hasCredentials(settings) else { return }
        syncing = true
        defer { syncing = false }
        do {
            let api = APIClient(baseURL: settings.serverURL, token: settings.token)
            if let (catalog, tag) = try await api.catalog(etag: library.etag) {
                let appeared = library.merge(catalog, etag: tag)
                if auto, settings.downloadNewAutomatically, !appeared.isEmpty {
                    autoDownload(appeared, settings: settings, library: library)
                }
            }
            synced = true
            recordSuccess()
        } catch {
            record(error)
        }
    }

    private func recordSuccess() {
        reachable = true
        forbidden = false
        unauthorized = false
        failureMessage = nil
    }

    private func record(_ error: Error) {
        forbidden = false
        unauthorized = false
        switch error {
        case let e as URLError where e.code != .cancelled:
            reachable = false
            failureMessage = e.code == .timedOut ? "The server took too long to answer. Try again." : "Can't reach the server. Check the connection and try again."
        case APIError.forbidden:
            reachable = true
            forbidden = true
            failureMessage = APIError.forbiddenMessage
        case APIError.http(401, _):
            reachable = true
            unauthorized = true
            failureMessage = "The server didn't accept your sign-in (401). Sign out and sign in again."
        case APIError.http(let code, let detail):
            reachable = true
            failureMessage = detail.isEmpty ? "The server answered with error \(code). Try again later." : "The server answered with error \(code): \(detail)"
        case is DecodingError:
            reachable = true
            failureMessage = "The server's reply could not be read. Update the app and try again."
        default:
            failureMessage = error.localizedDescription
        }
        transferLog.error("request failed: \(String(describing: error), privacy: .public)")
    }

    private func autoDownload(_ tracks: [Track], settings: Settings, library: LibraryStore) {
        guard !autoRunning else { return }
        autoRunning = true
        Task {
            for t in tracks { _ = await download(t, settings: settings, into: library, quiet: true) }
            autoRunning = false
        }
    }

    /// A song just saved from the Add sheet but not copied to the phone: lists it once the server has finished it.
    func listWhenSaved(_ id: String, settings: Settings, library: LibraryStore) {
        Task {
            let api = APIClient(baseURL: settings.serverURL, token: settings.token)
            for _ in 0..<120 {
                try? await Task.sleep(for: .seconds(2))
                if let st = try? await api.status(id) {
                    if st.status == "done" { await syncCatalog(settings: settings, library: library, auto: false); return }
                    if st.status == "error" { return }
                }
            }
        }
    }

    func check(settings: Settings) async {
        guard !checking else { return }
        guard !settings.token.isEmpty || AuthService.shared.isSignedIn else { reachable = nil; return }
        checking = true
        defer { checking = false }
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).verify()
            recordSuccess()
        } catch {
            record(error)
        }
    }

    func clearForbidden() { forbidden = false; unauthorized = false; failureMessage = nil }

    func setReachable(_ value: Bool) { reachable = value }

    /// Copies a song that is on the server onto the phone; the Library shows it as "Downloading NN%" meanwhile.
    @discardableResult
    func download(_ track: Track, settings: Settings, into library: LibraryStore, quiet: Bool = false) async -> Bool {
        if library.contains(track.id) { return true }
        guard !book.contains(track.id) else { return false }
        let gen = begin(track)
        defer { end(track.id, generation: gen) }
        guard await copy(track, settings: settings, from: 0, span: 1) else {
            failed.insert(track.id)
            if !quiet { notice = copyError ?? "Couldn't download \"\(track.title)\". Check the server and try again." }
            return false
        }
        add(track, to: library)
        failed.remove(track.id)
        return true
    }

    /// A song just saved on the server: the row appears at once, the server's fetch fills the first 80%, the copy to the phone the rest.
    func startIngest(_ track: Track, settings: Settings, library: LibraryStore, player: PlayerService?, playWhenReady: Bool) {
        let gen = begin(track)
        Task { await ingest(track, generation: gen, settings: settings, library: library, player: player, playWhenReady: playWhenReady) }
    }

    /// A catalog song with no audio anywhere: the server fetches it from the song's link, then the copy to the phone follows.
    func getAudio(_ track: Track, settings: Settings, library: LibraryStore, player: PlayerService?, playWhenReady: Bool) {
        guard !book.contains(track.id), !library.contains(track.id) else { return }
        let gen = begin(track)
        Task {
            do {
                try await APIClient(baseURL: settings.serverURL, token: settings.token).fetchAudio(track.id)
            } catch {
                end(track.id, generation: gen)
                failed.insert(track.id)
                notice = error.localizedDescription
                return
            }
            await ingest(track, generation: gen, settings: settings, library: library, player: player, playWhenReady: playWhenReady)
        }
    }

    private func ingest(_ track: Track, generation gen: Int, settings: Settings, library: LibraryStore, player: PlayerService?, playWhenReady: Bool) async {
        transferLog.debug("ingest begin \(track.id, privacy: .public)")
        defer {
            end(track.id, generation: gen)
            transferLog.debug("ingest end \(track.id, privacy: .public)")
        }
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        var misses = 0
        while true {
            try? await Task.sleep(for: .seconds(1))
            do {
                let st = try await api.status(track.id)
                misses = 0
                book.setProgress(track.id, generation: gen, 0.8 * (st.progress ?? 0))
                if st.status == "error" { fail(track, "Download failed: \(st.error ?? "unknown error")"); return }
                if st.status == "done" { break }
            } catch {
                misses += 1
                if misses >= 8 { fail(track, error.localizedDescription); return }
            }
        }
        guard await copy(track, settings: settings, from: 0.8, span: 0.2) else {
            fail(track, copyError ?? "Saved on the server, but not copied to this iPhone. Fetch the link again to download it.")
            return
        }
        add(track, to: library)
        failed.remove(track.id)
        if playWhenReady { player?.playNow(track) }
    }

    private func copy(_ track: Track, settings: Settings, from base: Double, span: Double) async -> Bool {
        let gen = book.generation(track.id)
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).downloadFile(track) { [weak self] p in
                Task { @MainActor in self?.progress(track.id, generation: gen, base + span * p) }
            }
            return true
        } catch {
            copyError = error.localizedDescription.hasPrefix("Mobile data") ? error.localizedDescription : nil
            return false
        }
    }

    private func begin(_ track: Track) -> Int {
        transferLog.debug("transfer start \(track.id, privacy: .public)")
        return book.start(track)
    }

    private func end(_ id: String, generation: Int) {
        book.finish(id, generation: generation)
        transferLog.debug("transfer cleared \(id, privacy: .public)")
    }

    private func progress(_ id: String, generation: Int?, _ value: Double) {
        if value >= 1 { transferLog.debug("transfer progress 100% \(id, privacy: .public)") }
        book.setProgress(id, generation: generation, value)
    }

    private func add(_ track: Track, to library: LibraryStore) {
        library.add(track)
        transferLog.debug("library.add \(track.id, privacy: .public) onPhone=\(library.contains(track.id))")
        reconcile(library)
    }

    /// Drops transfers whose song is already on the phone, so a finished row can never linger.
    func reconcile(_ library: LibraryStore) {
        for id in book.reconcile(onPhone: library.contains) {
            transferLog.debug("transfer cleared by reconcile \(id, privacy: .public)")
        }
    }

    private func fail(_ track: Track, _ message: String) {
        failed.insert(track.id)
        notice = message
    }
}
