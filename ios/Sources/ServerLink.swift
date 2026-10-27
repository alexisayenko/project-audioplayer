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
    var cover_v: String?
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
              thumbnail: cover != nil ? "/covers/\(id)" + (cover_v.map { "?v=\($0)" } ?? "") : nil, album: album, remixer: remixer, year: year, tags: tags, bpm: bpm,
              sourceURL: source_url, wikipediaSong: wikipedia_song, wikipediaArtist: wikipedia_artist, musicbrainzURL: musicbrainz_url,
              addedAt: added_at.flatMap(Self.parseDate), sources: sources, onServer: audio_state.map { $0 == "server" },
              version: version, mainArtists: mainArtists, featuredArtists: featuredArtists, withArtists: withArtists,
              releaseYear: releaseYear, albums: albums, genres: genres, remixYear: remix_year, rawTitle: rawTitle,
              wikipediaAlbum: wikipedia_album, discogsURL: discogs_url)
    }

    private static func parseDate(_ s: String) -> Date? { ISO8601DateFormatter().date(from: s) }
}

/// Progress of "Download all to iPhone".
struct BulkDownload: Equatable {
    var total = 0
    var done = 0
    var failed = 0
    var running = false
    var cancelled = false
    var stopReason: String?

    var processed: Int { done + failed }
    var fraction: Double { total == 0 ? 0 : Double(processed) / Double(total) }
    var hasResult: Bool { !running && total > 0 }

    var summary: String {
        var parts = ["\(done) of \(total) downloaded"]
        if failed > 0 { parts.append("\(failed) failed") }
        if cancelled { parts.append("cancelled") }
        if let stopReason { parts.append(stopReason) }
        return parts.joined(separator: ", ")
    }
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
    /// The songs now arriving; their percent lives in `board`, not in `Transfer.progress`.
    var transfers: [String: Transfer] { book.items }
    /// The percent of each running download; views that show it observe this, so a tick does not wake everything that watches the link.
    let board = TransferProgress()
    @Published private(set) var failed: Set<String> = []
    /// A failure to tell the person about once (Library shows it as a toast).
    @Published var notice: String?
    private var listTasks: [String: Task<Void, Never>] = [:]
    @Published private(set) var syncing = false
    /// True once a catalog has been fetched (or confirmed unchanged) since launch.
    @Published private(set) var synced = false
    private var autoRunning = false
    /// Songs whose server job is waiting for a download slot (status `queued`); the UI shows "Waiting..." for them.
    @Published private(set) var waiting: Set<String> = []
    @Published private(set) var bulk = BulkDownload()
    private var bulkTask: Task<Void, Never>?
    private var bulkQueue: [Track] = []
    private var bulkStreak: Set<String> = []
    private static let bulkConcurrency = 2
    private static let bulkMaxStreak = 3
    private static weak var current: ServerLink?

    init() { Self.current = self }

    /// Fed by every `APIClient` request (see `APIClient.reporting`); publishes only when the state really changes.
    static func note(reachable value: Bool) {
        current?.setReachable(value)
    }

    /// The percent of a running download, nil when the song is not arriving; read it where `board` is observed.
    func progress(of id: String) -> Double? {
        book.contains(id) ? board.values[id] ?? 0 : nil
    }

    static func hasCredentials(_ settings: Settings) -> Bool {
        !settings.token.isEmpty || AuthService.shared.isSignedIn
    }

    /// Fetches the catalog with the stored ETag and merges it. Failures are quiet: the status LED turns off and the cached catalog stays.
    func syncCatalog(settings: Settings, library: LibraryStore, auto: Bool = true) async {
        adoptArrivedDownloads(into: library)
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

    /// Lists the songs whose file arrived while the app was not running (the system finished a background download).
    func adoptArrivedDownloads(into library: LibraryStore) {
        for track in BackgroundDownloader.shared.takeArrived() { add(track, to: library) }
    }

    private func recordSuccess() {
        setReachable(true)
        setStatus(forbidden: false, unauthorized: false, message: nil)
    }

    private func setStatus(forbidden newForbidden: Bool, unauthorized newUnauthorized: Bool, message: String?) {
        if forbidden != newForbidden { forbidden = newForbidden }
        if unauthorized != newUnauthorized { unauthorized = newUnauthorized }
        if failureMessage != message { failureMessage = message }
    }

    private func record(_ error: Error) {
        switch error {
        case let e as URLError where e.code != .cancelled:
            setReachable(false)
            setStatus(forbidden: false, unauthorized: false,
                      message: e.code == .timedOut ? "The server took too long to answer. Try again." : "Can't reach the server. Check the connection and try again.")
        case APIError.forbidden:
            setReachable(true)
            setStatus(forbidden: true, unauthorized: false, message: APIError.forbiddenMessage)
        case APIError.http(401, _):
            setReachable(true)
            setStatus(forbidden: false, unauthorized: true, message: "The server didn't accept your sign-in (401). Sign out and sign in again.")
        case APIError.http(let code, let detail):
            setReachable(true)
            setStatus(forbidden: false, unauthorized: false,
                      message: detail.isEmpty ? "The server answered with error \(code). Try again later." : "The server answered with error \(code): \(detail)")
        case is DecodingError:
            setReachable(true)
            setStatus(forbidden: false, unauthorized: false, message: "The server's reply could not be read. Update the app and try again.")
        default:
            setStatus(forbidden: false, unauthorized: false, message: error.localizedDescription)
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
        listTasks[id]?.cancel()
        listTasks[id] = Task {
            defer { listTasks[id] = nil; setWaiting(id, false) }
            let api = APIClient(baseURL: settings.serverURL, token: settings.token)
            var misses = 0
            for _ in 0..<900 {
                try? await Task.sleep(for: .seconds(2))
                if Task.isCancelled { return }
                do {
                    let st = try await api.status(id)
                    misses = 0
                    setWaiting(id, st.isQueued)
                    if st.status == "done" { await syncCatalog(settings: settings, library: library, auto: false); return }
                    if st.status == "error" { notice = st.failureMessage; return }
                } catch {
                    if Task.isCancelled { return }
                    misses += 1
                    if misses >= 8 || Self.isFatal(error) {
                        record(error)
                        notice = failureMessage ?? error.localizedDescription
                        return
                    }
                }
            }
        }
    }

    private func setFailed(_ id: String) {
        if !failed.contains(id) { failed.insert(id) }
    }

    private func clearFailure(_ id: String) {
        if failed.contains(id) { failed.remove(id) }
    }

    private func setWaiting(_ id: String, _ value: Bool) {
        guard waiting.contains(id) != value else { return }
        if value { waiting.insert(id) } else { waiting.remove(id) }
    }

    private static func isFatal(_ error: Error) -> Bool {
        switch error {
        case APIError.forbidden: return true
        case APIError.http(let code, _): return code == 401 || code == 404
        default: return false
        }
    }

    /// Stops the background polling and the bulk download, e.g. on sign-out.
    func cancelBackgroundWork() {
        for task in listTasks.values { task.cancel() }
        listTasks = [:]
        waiting = []
        cancelDownloadAll()
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

    func clearForbidden() { setStatus(forbidden: false, unauthorized: false, message: nil) }

    func setReachable(_ value: Bool) {
        guard reachable != value else { return }
        reachable = value
    }

    /// Copies a song that is on the server onto the phone; the Library shows it as "Downloading NN%" meanwhile.
    @discardableResult
    func download(_ track: Track, settings: Settings, into library: LibraryStore, quiet: Bool = false) async -> Bool {
        if case .done = await fetch(track, settings: settings, into: library, quiet: quiet) { return true }
        return false
    }

    private enum FetchOutcome {
        case done
        case busy
        case failed(mobileDataMessage: String?)
    }

    private struct CopyFailure: Error {
        let mobileDataMessage: String?
    }

    private func fetch(_ track: Track, settings: Settings, into library: LibraryStore, quiet: Bool) async -> FetchOutcome {
        if library.contains(track.id) { return .done }
        guard !book.contains(track.id) else { return .busy }
        guard reachable != false else {
            setFailed(track.id)
            if !quiet { notice = "Can't reach the server. Check the connection and try again." }
            return .failed(mobileDataMessage: nil)
        }
        let gen = begin(track)
        defer { end(track.id, generation: gen) }
        switch await copy(track, settings: settings, from: 0, span: 1) {
        case .success:
            add(track, to: library)
            clearFailure(track.id)
            return .done
        case .failure(let f):
            setFailed(track.id)
            if !quiet { notice = f.mobileDataMessage ?? "Couldn't download \"\(track.title)\". Check the server and try again." }
            return .failed(mobileDataMessage: f.mobileDataMessage)
        }
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
            setWaiting(track.id, false)
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
                setWaiting(track.id, st.isQueued)
                progress(track.id, generation: gen, 0.8 * (st.isQueued ? 0 : st.progress ?? 0))
                if st.status == "error" { fail(track, st.failureMessage); return }
                if st.status == "done" { break }
            } catch {
                misses += 1
                if misses >= 8 { fail(track, error.localizedDescription); return }
            }
        }
        if case .failure(let f) = await copy(track, settings: settings, from: 0.8, span: 0.2) {
            fail(track, f.mobileDataMessage ?? "Saved on the server, but not copied to this iPhone. Fetch the link again to download it.")
            return
        }
        add(track, to: library)
        clearFailure(track.id)
        if playWhenReady { player?.playNow(track) }
    }

    private func copy(_ track: Track, settings: Settings, from base: Double, span: Double) async -> Result<Void, CopyFailure> {
        let gen = book.generation(track.id)
        let gate = ProgressGate()
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).downloadFile(track) { [weak self] p in
                let value = base + span * p
                guard gate.admit(value) else { return }
                Task { @MainActor in self?.progress(track.id, generation: gen, value) }
            }
            return .success(())
        } catch {
            let text = error.localizedDescription
            return .failure(CopyFailure(mobileDataMessage: text.hasPrefix("Mobile data") ? text : nil))
        }
    }

    private func begin(_ track: Track) -> Int {
        transferLog.debug("transfer start \(track.id, privacy: .public)")
        let generation = book.start(track)
        board.set(track.id, 0)
        return generation
    }

    private func end(_ id: String, generation: Int) {
        if book.generation(id) == generation {
            board.clear(id)
            book.finish(id, generation: generation)
        }
        transferLog.debug("transfer cleared \(id, privacy: .public)")
    }

    private func progress(_ id: String, generation: Int?, _ value: Double) {
        if value >= 1 { transferLog.debug("transfer progress 100% \(id, privacy: .public)") }
        guard let generation, book.generation(id) == generation else { return }
        board.set(id, value)
    }

    private func add(_ track: Track, to library: LibraryStore) {
        library.add(track)
        transferLog.debug("library.add \(track.id, privacy: .public) onPhone=\(library.contains(track.id))")
        reconcile(library)
    }

    /// Drops transfers whose song is already on the phone, so a finished row can never linger.
    func reconcile(_ library: LibraryStore) {
        guard book.items.keys.contains(where: library.contains) else { return }
        let dropped = book.reconcile(onPhone: library.contains)
        board.clear(dropped)
        for id in dropped {
            transferLog.debug("transfer cleared by reconcile \(id, privacy: .public)")
        }
    }

    /// Copies every song that is on the server but not on this iPhone, two at a time. Safe to run again: finished songs are skipped.
    func downloadAllMissing(settings: Settings, library: LibraryStore) async {
        guard !bulk.running else { return }
        let pending = library.songs.filter { $0.onServer != false && $0.localOnly != true && !library.contains($0.id) && !book.contains($0.id) }
        bulk = BulkDownload(total: pending.count, running: !pending.isEmpty)
        guard !pending.isEmpty else { return }
        bulkQueue = pending
        bulkStreak = []
        let task = Task { @MainActor in
            await withTaskGroup(of: Void.self) { group in
                for _ in 0..<Self.bulkConcurrency {
                    group.addTask { @MainActor [self] in await bulkWorker(settings: settings, library: library) }
                }
            }
            if Task.isCancelled { bulk.cancelled = true }
            bulkQueue = []
            bulk.running = false
        }
        bulkTask = task
        await task.value
        bulkTask = nil
    }

    /// Stops after the transfers already running; the rest stay for the next run.
    func cancelDownloadAll() {
        bulkTask?.cancel()
    }

    private func bulkWorker(settings: Settings, library: LibraryStore) async {
        while !Task.isCancelled, bulk.stopReason == nil, !bulkQueue.isEmpty {
            let track = bulkQueue.removeFirst()
            switch await fetch(track, settings: settings, into: library, quiet: true) {
            case .done:
                bulk.done += 1
                bulkStreak = []
            case .busy:
                bulk.total -= 1
            case .failed(let mobileDataMessage):
                bulk.failed += 1
                bulkStreak.insert(track.id)
                if bulk.stopReason == nil {
                    if let mobileDataMessage {
                        bulk.stopReason = mobileDataMessage
                    } else if bulkStreak.count >= Self.bulkMaxStreak {
                        bulk.stopReason = "stopped after repeated errors"
                    }
                }
            }
        }
    }

    private func fail(_ track: Track, _ message: String) {
        failed.insert(track.id)
        notice = message
    }
}
