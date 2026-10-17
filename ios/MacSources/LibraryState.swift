import Foundation
import SwiftUI

enum LibSort: String, CaseIterable, Identifiable {
    case added = "Recently added", title = "Title", artist = "Artist", year = "Year", bpm = "BPM"
    var id: String { rawValue }
}

extension FilterCategory {
    /// "Not set" is a reserved token, never saved on a song. Plain tags have none.
    var unsetToken: String? {
        switch self {
        case .genres: "genre:__unset__"
        case .years: "decade:__unset__"
        case .countries: "country:__unset__"
        case .tags: nil
        }
    }

    var unsetLabel: String {
        switch self {
        case .genres: "Songs with no genre"
        case .years: "Songs with no year"
        case .countries: "Songs with no country"
        case .tags: ""
        }
    }
}

/// Values inside a category are alternatives, categories narrow each other; "not set" matches songs without any tag of the category.
func libFilterMatches(_ t: Track, selection: Set<String>) -> Bool {
    guard !selection.isEmpty else { return true }
    let tags = (t.tags ?? []).map { $0.lowercased() }
    for category in FilterCategory.allCases {
        let picked = selection.filter { category.owns($0) }
        if picked.isEmpty { continue }
        let unset = category.unsetToken
        let real = picked.filter { $0 != unset }
        let hit = !Set(tags).isDisjoint(with: real)
        let missing = unset != nil && picked.contains(unset!) && !tags.contains { category.owns($0) }
        if !(hit || missing) { return false }
    }
    return true
}

struct SongFetch: Equatable {
    enum Phase { case queued, running, converting, failed }
    var phase: Phase
    var progress: Double
}

enum SongFormTarget: Identifiable {
    case add(String)
    case edit(Track)

    var id: String {
        switch self {
        case .add(let link): "add:\(link)"
        case .edit(let t): "edit:\(t.id)"
        }
    }
}

/// Library view state that survives page switches within a run (search, sort, filters), plus the server-side audio fetches.
@MainActor
final class LibraryUIState: ObservableObject {
    static let shared = LibraryUIState()

    @Published var search = ""
    @Published var sort = LibSort.added
    @Published var filters: Set<String> = []
    @Published var rowSelection: String?
    @Published var revealID: String?
    @Published var toast: String?
    @Published private(set) var coverRev: [String: Int] = [:]
    @Published private(set) var fetches: [String: SongFetch] = [:]
    /// Hourly add limit hit: all fetches wait until this time.
    @Published private(set) var pausedUntil: Date?

    private static let autoKey = "ap2.autodl"
    @Published var autoDownload: Bool = UserDefaults.standard.bool(forKey: LibraryUIState.autoKey) {
        didSet { UserDefaults.standard.set(autoDownload, forKey: Self.autoKey) }
    }

    private var pending: [(id: String, request: Bool, play: Bool)] = []
    private var running = false

    var filtersActive: Bool { !filters.isEmpty || !search.trimmingCharacters(in: .whitespaces).isEmpty }

    func bumpCover(_ id: String) {
        LibCover.evict(id)
        let key = Endpoints.coversPrefix + id
        coverRev[key, default: 0] += 1
    }

    func clearFilters() { search = ""; filters = [] }

    func reveal(_ id: String) {
        clearFilters()
        rowSelection = id
        revealID = id
    }

    /// Asks the server to fetch the audio of a catalog song and follows its progress. One fetch runs at a time.
    /// `request` is false when the server already started the job (Add and download).
    func fetch(_ track: Track, request: Bool = true, play: Bool = false,
               settings: Settings, library: LibraryStore, server: ServerLink, player: PlayerService) {
        guard fetches[track.id]?.phase != .running, !pending.contains(where: { $0.id == track.id }) else { return }
        fetches[track.id] = SongFetch(phase: .queued, progress: 0)
        pending.append((track.id, request, play))
        guard !running else { return }
        running = true
        Task {
            while !pending.isEmpty {
                let next = pending.removeFirst()
                await run(next, settings: settings, library: library, server: server, player: player)
            }
            running = false
        }
    }

    private func run(_ job: (id: String, request: Bool, play: Bool), settings: Settings, library: LibraryStore, server: ServerLink, player: PlayerService) async {
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        if let until = pausedUntil {
            let wait = until.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            pausedUntil = nil
        }
        fetches[job.id] = SongFetch(phase: .running, progress: 0)
        if job.request {
            do { try await api.fetchAudio(job.id) }
            catch {
                fail(job.id, error)
                return
            }
        }
        var misses = 0
        for _ in 0..<900 {
            try? await Task.sleep(for: .seconds(1))
            do {
                let st = try await api.status(job.id)
                misses = 0
                switch st.status {
                case "done":
                    fetches[job.id] = SongFetch(phase: .running, progress: 1)
                    try? await Task.sleep(for: .seconds(0.6))
                    await server.syncCatalog(settings: settings, library: library, auto: false)
                    fetches[job.id] = nil
                    if job.play, let t = library.songs.first(where: { $0.id == job.id }) { player.playNow(t) }
                    return
                case "error":
                    fail(job.id, APIError.http(0, "Download failed: \(st.error ?? "unknown error")"))
                    return
                case "converting":
                    fetches[job.id] = SongFetch(phase: .converting, progress: 1)
                default:
                    fetches[job.id] = SongFetch(phase: .running, progress: st.progress ?? 0)
                }
            } catch {
                misses += 1
                if misses >= 8 { fail(job.id, error); return }
            }
        }
        fail(job.id, APIError.http(0, "Download timed out"))
    }

    private func fail(_ id: String, _ error: Error) {
        fetches[id] = SongFetch(phase: .failed, progress: 0)
        if case APIError.refused(let code, let detail) = error, code == "hourly_limit" {
            toast = detail
            pausedUntil = Date().addingTimeInterval(15 * 60)
        } else {
            toast = error.localizedDescription
        }
    }

    func dismissFailure(_ id: String) {
        if fetches[id]?.phase == .failed { fetches[id] = nil }
    }
}
