import Foundation

/// The last playlists and albums read from the server, kept for the account that read them so the lists open offline.
enum CollectionCache {
    private struct Snapshot<T: Codable>: Codable {
        var account: String
        var value: T
    }

    private static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("collections", isDirectory: true)
    }

    static func read<T: Codable>(_ type: T.Type, _ name: String) -> (account: String, value: T)? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(name + ".json")),
              let snap = try? JSONDecoder().decode(Snapshot<T>.self, from: data) else { return nil }
        return (snap.account, snap.value)
    }

    static func write<T: Codable>(_ value: T, account: String, _ name: String) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(Snapshot(account: account, value: value)) else { return }
        try? data.write(to: directory.appendingPathComponent(name + ".json"), options: .atomic)
    }

    static func remove(_ name: String) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(name + ".json"))
    }

    /// Who the cached lists belong to: server and sign-in, never a token.
    @MainActor static func accountKey(_ settings: Settings) -> String {
        let session = AuthService.shared.session
        return [settings.serverURL, session?.email ?? "", session?.provider.rawValue ?? "", settings.token.isEmpty ? "" : "legacy"].joined(separator: "|")
    }
}

@MainActor
final class PlaylistStore: ObservableObject {
    @Published private(set) var lists: [PlaylistSummary] = []
    @Published private(set) var details: [String: PlaylistDetail] = [:]
    @Published private(set) var loaded = false
    @Published private(set) var loading = false
    @Published private(set) var failure: String?
    private var account = ""
    private static let listName = "playlists"
    private static let detailName = "playlist-details"

    init() {
        guard let cached = CollectionCache.read([PlaylistSummary].self, Self.listName) else { return }
        account = cached.account
        lists = cached.value
        details = CollectionCache.read([String: PlaylistDetail].self, Self.detailName).map(\.value) ?? [:]
        loaded = true
    }

    private func api(_ settings: Settings) -> APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }

    /// Drops lists that belong to another account or to nobody.
    func adopt(_ settings: Settings, signedIn: Bool) {
        let key = signedIn ? CollectionCache.accountKey(settings) : ""
        guard key != account else { return }
        account = key
        lists = []
        details = [:]
        loaded = false
        failure = nil
        CollectionCache.remove(Self.listName)
        CollectionCache.remove(Self.detailName)
    }

    func refresh(_ settings: Settings) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            lists = PlaylistLogic.sorted(try await api(settings).playlists())
            loaded = true
            failure = nil
            save()
        } catch {
            failure = error.localizedDescription
        }
    }

    @discardableResult
    func loadDetail(_ id: String, _ settings: Settings) async -> PlaylistDetail? {
        do {
            let detail = try await api(settings).playlist(id)
            store(detail)
            return detail
        } catch {
            if case APIError.http(404, _) = error { forget(id) }
            return details[id]
        }
    }

    func create(name: String, songIDs: [String] = [], _ settings: Settings) async throws -> PlaylistDetail {
        let detail = try await api(settings).createPlaylist(name: name, songIDs: songIDs)
        store(detail)
        return detail
    }

    func rename(_ id: String, to name: String, _ settings: Settings) async throws {
        store(try await api(settings).renamePlaylist(id, name: name))
    }

    func delete(_ id: String, _ settings: Settings) async throws {
        try await api(settings).deletePlaylist(id)
        forget(id)
    }

    @discardableResult
    func add(_ songIDs: [String], to id: String, _ settings: Settings) async throws -> PlaylistAddResult {
        let result = try await api(settings).addToPlaylist(id, songIDs: songIDs)
        if result.added > 0 { await loadDetail(id, settings) }
        return result
    }

    func remove(_ songID: String, from id: String, _ settings: Settings) async throws {
        try await api(settings).removeFromPlaylist(id, songID: songID)
        guard var detail = details[id] else { return }
        detail.songs.removeAll { $0 == songID }
        store(detail)
    }

    func reorder(_ id: String, to songIDs: [String], _ settings: Settings) async throws {
        let before = details[id]
        if var local = before {
            local.songs = songIDs
            store(local)
        }
        do {
            store(try await api(settings).reorderPlaylist(id, songIDs: songIDs))
        } catch {
            if let before { store(before) }
            throw error
        }
    }

    private func store(_ detail: PlaylistDetail) {
        details[detail.id] = detail
        if let at = lists.firstIndex(where: { $0.id == detail.id }) { lists[at] = detail.summary } else { lists.append(detail.summary) }
        lists = PlaylistLogic.sorted(lists)
        save()
    }

    private func forget(_ id: String) {
        details[id] = nil
        lists.removeAll { $0.id == id }
        save()
    }

    private func save() {
        CollectionCache.write(lists, account: account, Self.listName)
        CollectionCache.write(details, account: account, Self.detailName)
    }
}

@MainActor
final class AlbumStore: ObservableObject {
    @Published private(set) var albums: [Album] = []
    @Published private(set) var loaded = false
    @Published private(set) var loading = false
    @Published private(set) var failure: String?
    @Published private(set) var usage: ServerUsage?
    private var account = ""
    private static let name = "albums"

    init() {
        guard let cached = CollectionCache.read([Album].self, Self.name) else { return }
        account = cached.account
        albums = cached.value
        loaded = true
    }

    func album(_ id: String) -> Album? { albums.first { $0.id == id } }

    func adopt(_ settings: Settings, signedIn: Bool) {
        let key = signedIn ? CollectionCache.accountKey(settings) : ""
        guard key != account else { return }
        account = key
        albums = []
        loaded = false
        failure = nil
        usage = nil
        CollectionCache.remove(Self.name)
    }

    func refresh(_ settings: Settings) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            albums = try await APIClient(baseURL: settings.serverURL, token: settings.token).albums()
            loaded = true
            failure = nil
            CollectionCache.write(albums, account: account, Self.name)
        } catch {
            failure = error.localizedDescription
        }
    }

    /// The account's quotas for the plan sheet; nil when the server does not answer.
    func loadUsage(_ settings: Settings) async -> ServerUsage? {
        let fresh = try? await APIClient(baseURL: settings.serverURL, token: settings.token).usage()
        usage = fresh
        return fresh
    }
}
