import Foundation

/// The owner's public library as a signed-out visitor sees it (ADR-0018), kept in memory only.
/// It is never merged into `LibraryStore`: that merge would mark the songs on a signed-out phone as local-only.
@MainActor
final class GuestCatalog: ObservableObject {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case unavailable
        case failed(String)
    }

    @Published private(set) var songs: [Track] = []
    @Published private(set) var phase = Phase.idle
    @Published private(set) var ownerLabel: String?
    @Published private(set) var audioEnabled = true
    private var etag: String?
    private var running = false

    var libraryName: String { ownerLabel.flatMap { $0.isEmpty ? nil : "\($0)'s library" } ?? "Library" }

    var bannerText: String { ownerLabel.flatMap { $0.isEmpty ? nil : "Viewing \($0)'s library (read-only)" } ?? "Viewing the public library (read-only)" }

    /// Fetches `/me` and `/catalog` anonymously. Returns a message to show when the refresh failed.
    @discardableResult
    func refresh(settings: Settings) async -> String? {
        guard !running else { return nil }
        running = true
        defer { running = false }
        if songs.isEmpty { phase = .loading }
        let api = APIClient(baseURL: settings.serverURL, token: "", anonymous: true)
        do {
            let info = try await api.guestInfo()
            ownerLabel = info.ownerLabel
            audioEnabled = info.audio
            if let (catalog, tag) = try await api.catalog(etag: etag) {
                var seen = Set<String>()
                songs = catalog.songs.filter { seen.insert($0.id).inserted }.map(\.track)
                etag = tag
            }
            phase = .loaded
            return nil
        } catch {
            let message = Self.message(error)
            if case APIError.http(401, _) = error {
                songs = []
                etag = nil
                phase = .unavailable
            } else if songs.isEmpty {
                phase = .failed(message)
            }
            return message
        }
    }

    private static func message(_ error: Error) -> String {
        switch error {
        case APIError.http(401, _): return "The public library isn't available right now. Sign in to use your own."
        case is URLError, APIError.unreachable: return "Can't reach the server. Check the connection and try again."
        case is DecodingError: return "The server's reply could not be read. Update the app and try again."
        default: return error.localizedDescription
        }
    }

    func streamURL(for track: Track, settings: Settings) -> URL? {
        guard audioEnabled, !ServerLink.hasCredentials(settings), track.onServer != false else { return nil }
        return GuestStream.fileURL(baseURL: settings.serverURL, id: track.id)
    }

    func hasAudio(_ track: Track) -> Bool { track.onServer ?? true }

    private var mergeCache: (guest: [Track], library: [Track], phoneIDs: Set<String>, merged: [Track])?

    /// One list for a signed-out phone: the owner's public library plus the songs on the phone that it does not list.
    /// Recomputed only when the guest songs, the library songs or the phone set change; unchanged inputs share storage, so the check is O(1).
    func songs(mergedWith library: LibraryStore) -> [Track] {
        if let c = mergeCache, c.guest == songs, c.library == library.songs, c.phoneIDs == library.phoneIDs { return c.merged }
        let listed = Set(songs.map(\.id))
        let merged = songs + library.tracks.filter { !listed.contains($0.id) }
        mergeCache = (songs, library.songs, library.phoneIDs, merged)
        return merged
    }

    var settled: Bool {
        switch phase {
        case .idle, .loading: false
        default: true
        }
    }
}
