import CryptoKit
import Foundation

/// The catalog on this iPhone: every song the server lists (cached for offline use) plus the songs whose audio is stored here.
/// A song is "on the phone" when its file exists in `Documents/audio`; that is never written to `library.json`.
@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var songs: [Track] = []
    @Published private(set) var phoneIDs: Set<String> = []
    /// ETag of the last catalog the server sent, for `If-None-Match`.
    private(set) var etag: String?
    private var prefetchTask: Task<Void, Never>?
    private var prefetchAgain = false

    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let audioDirectory = documents.appendingPathComponent("audio", isDirectory: true)
    private static let indexURL = documents.appendingPathComponent("library.json")

    /// Bumped when the cached song records gain fields, so the next sync refetches the catalog instead of answering 304.
    private static let schema = 2

    private struct Stored: Codable {
        var etag: String?
        var schema: Int?
        var songs: [Track]
    }

    /// Songs whose audio is on this iPhone.
    var tracks: [Track] { songs.filter { phoneIDs.contains($0.id) } }

    init() {
        try? FileManager.default.createDirectory(at: Self.audioDirectory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: Self.indexURL) {
            if let stored = try? JSONDecoder().decode(Stored.self, from: data) {
                songs = stored.songs
                etag = stored.schema == Self.schema ? stored.etag : nil
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
        prefetchCovers()
    }

    func contains(_ id: String) -> Bool { phoneIDs.contains(id) }

    /// A song whose file has just arrived on the phone.
    func add(_ track: Track) {
        var t = track
        if let i = songs.firstIndex(where: { $0.id == t.id }) {
            t.addedAt = t.addedAt ?? songs[i].addedAt
            t.sources = t.sources ?? songs[i].sources
            t.localOnly = songs[i].localOnly
            t.inheritDetail(from: songs[i])
            t.onServer = songs[i].localOnly == true ? false : true
            songs[i] = t
        } else {
            t.addedAt = t.addedAt ?? Date()
            t.onServer = true
            songs.insert(t, at: 0)
        }
        phoneIDs.insert(t.id)
        save()
        prefetchCovers()
    }

    func update(_ track: Track) {
        guard let i = songs.firstIndex(where: { $0.id == track.id }) else { return }
        var merged = track
        merged.thumbnail = track.thumbnail ?? songs[i].thumbnail
        merged.addedAt = track.addedAt ?? songs[i].addedAt
        merged.sources = track.sources ?? songs[i].sources
        merged.onServer = track.onServer ?? songs[i].onServer
        merged.localOnly = songs[i].localOnly
        let coverChanged = merged.thumbnail != songs[i].thumbnail
        songs[i] = merged
        save()
        if coverChanged { coverDidChange(track.id, merged.thumbnail) }
    }

    func setThumbnail(_ id: String, _ value: String?) {
        guard let i = songs.firstIndex(where: { $0.id == id }) else { return }
        songs[i].thumbnail = value
        save()
        coverDidChange(id, value)
    }

    private func coverDidChange(_ id: String, _ value: String?) {
        CoverCache.invalidate(id)
        NotificationCenter.default.post(name: .trackThumbnailChanged, object: nil, userInfo: ["id": id, "thumbnail": value as Any])
        prefetchCovers()
    }

    /// Fetches the server covers of the songs on the phone into the disk cache, so they show offline.
    /// Calls arriving while a run is going are merged into one more run; covers already stored are skipped.
    private func prefetchCovers() {
        guard prefetchTask == nil else { prefetchAgain = true; return }
        prefetchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            while let self, !Task.isCancelled {
                let phone = self.songs.filter { self.phoneIDs.contains($0.id) }
                let settings = Settings()
                let base = settings.serverURL, token = settings.token
                let missing = await CoverCache.missing(phone.compactMap(\.thumbnail).filter { CoverCache.isServerCover($0) }, baseURL: base)
                for source in missing {
                    if Task.isCancelled { break }
                    _ = await CoverCache.data(for: source, baseURL: base, token: token)
                }
                let keep = Set(phone.map(\.id))
                await Task.detached(priority: .utility) { CoverCache.prune(keeping: keep) }.value
                guard self.prefetchAgain else { break }
                self.prefetchAgain = false
            }
            self?.prefetchTask = nil
        }
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
        CoverCache.invalidate(id)
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
        var coverChanges: [(id: String, thumbnail: String?)] = []
        for s in catalog.songs where seen.insert(s.id).inserted {
            var t = s.track
            if let prev = old[s.id] {
                t.addedAt = t.addedAt ?? prev.addedAt
                t.thumbnail = t.thumbnail ?? prev.thumbnail
                if t.thumbnail != prev.thumbnail { coverChanges.append((s.id, t.thumbnail)) }
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
            } else {
                CoverCache.invalidate(prev.id)
            }
        }
        songs = result
        phoneIDs = phoneIDs.intersection(Set(result.map(\.id)))
        etag = newTag ?? "synced"
        save()
        for change in coverChanges { coverDidChange(change.id, change.thumbnail) }
        prefetchCovers()
        return appeared.filter { !phoneIDs.contains($0.id) }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(Stored(etag: etag, schema: Self.schema, songs: songs)) {
            try? data.write(to: Self.indexURL, options: .atomic)
        }
    }
}

extension Notification.Name {
    static let trackThumbnailChanged = Notification.Name("trackThumbnailChanged")
}

/// Server covers, kept in memory and on disk (Application Support, excluded from backup) so they show offline.
/// A source is `/covers/<id>`, optionally `?v=<cover_v>`; a different `v` means the cover changed and is fetched again.
/// Files are named by a hash of the id, so no id can reach outside the folder or collide with a marker file.
/// The cache belongs to one server host and account: another one empties it.
enum CoverCache {
    private final class Entry {
        let version: String
        let image: PlatformImage
        init(version: String, image: PlatformImage) { self.version = version; self.image = image }
    }

    private struct Ref {
        let id: String
        let path: String
        let version: String

        init?(_ source: String) {
            guard source.hasPrefix("/"), let c = URLComponents(string: source), let last = c.path.split(separator: "/").last else { return nil }
            id = String(last)
            path = c.path
            version = c.queryItems?.first { $0.name == "v" }?.value ?? ""
        }
    }

    private static let maxExtraBytes = 50_000_000
    private static let memory = NSCache<NSString, Entry>()
    private static let lock = NSLock()
    nonisolated(unsafe) private static var activeScope: String?

    private static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("covers", isDirectory: true)
    }

    private static func name(_ id: String) -> String {
        SHA256.hash(data: Data(id.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    private static func file(_ id: String) -> URL { directory.appendingPathComponent(name(id) + ".img") }
    private static func versionFile(_ id: String) -> URL { directory.appendingPathComponent(name(id) + ".ver") }
    private static var scopeFile: URL { directory.appendingPathComponent("scope.txt") }

    static func isServerCover(_ source: String?) -> Bool { source?.hasPrefix("/") == true }

    private static func prepare() {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: directory.path) else { return }
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        var dir = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
    }

    private static func ensureScope(baseURL: String) async {
        let account = await MainActor.run { AuthService.shared.session?.email ?? "" }
        let scope = (URL(string: baseURL)?.host ?? baseURL) + "|" + account
        switchScope(to: scope)
    }

    private static func switchScope(to scope: String) {
        lock.withLock {
            if activeScope == nil { activeScope = try? String(contentsOf: scopeFile, encoding: .utf8) }
            guard activeScope != scope else { return }
            memory.removeAllObjects()
            try? FileManager.default.removeItem(at: directory)
            prepare()
            try? scope.write(to: scopeFile, atomically: true, encoding: .utf8)
            activeScope = scope
        }
    }

    private static func isCached(_ ref: Ref) -> Bool {
        guard FileManager.default.fileExists(atPath: file(ref.id).path) else { return false }
        if ref.version.isEmpty { return true }
        return (try? String(contentsOf: versionFile(ref.id), encoding: .utf8)) == ref.version
    }

    /// The sources whose current cover is not stored yet.
    static func missing(_ sources: [String], baseURL: String) async -> [String] {
        await ensureScope(baseURL: baseURL)
        return sources.filter { s in Ref(s).map { !isCached($0) } ?? false }
    }

    /// The cover bytes: from disk when the stored version matches, else fetched; a failed fetch falls back to the stored copy.
    static func data(for source: String, baseURL: String, token: String) async -> Data? {
        guard let ref = Ref(source) else { return nil }
        await ensureScope(baseURL: baseURL)
        if isCached(ref), let stored = try? Data(contentsOf: file(ref.id)) { return stored }
        if let fresh = try? await APIClient(baseURL: baseURL, token: token).fetch(ref.path), PlatformImage(data: fresh) != nil {
            prepare()
            try? fresh.write(to: file(ref.id), options: .atomic)
            try? ref.version.write(to: versionFile(ref.id), atomically: true, encoding: .utf8)
            return fresh
        }
        return try? Data(contentsOf: file(ref.id))
    }

    static func image(for source: String, baseURL: String, token: String) async -> PlatformImage? {
        guard let ref = Ref(source) else { return nil }
        await ensureScope(baseURL: baseURL)
        if let hit = memory.object(forKey: ref.id as NSString), hit.version == ref.version || ref.version.isEmpty { return hit.image }
        guard let data = await data(for: source, baseURL: baseURL, token: token), let img = PlatformImage(data: data) else { return nil }
        memory.setObject(Entry(version: ref.version, image: img), forKey: ref.id as NSString)
        return img
    }

    static func invalidate(_ id: String) {
        memory.removeObject(forKey: id as NSString)
        try? FileManager.default.removeItem(at: file(id))
        try? FileManager.default.removeItem(at: versionFile(id))
    }

    /// Keeps the covers of `keep` always; the others stay only while they fit in a size cap (oldest go first).
    static func prune(keeping keep: Set<String>) {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys) else { return }
        let protected = Set(keep.map(name))
        var extra: [(url: URL, size: Int, date: Date)] = []
        for url in files where url.pathExtension == "img" {
            guard !protected.contains(url.deletingPathExtension().lastPathComponent) else { continue }
            let v = try? url.resourceValues(forKeys: Set(keys))
            extra.append((url, v?.fileSize ?? 0, v?.contentModificationDate ?? .distantPast))
        }
        var total = extra.reduce(0) { $0 + $1.size }
        for e in extra.sorted(by: { $0.date < $1.date }) where total > maxExtraBytes {
            try? fm.removeItem(at: e.url)
            try? fm.removeItem(at: e.url.deletingPathExtension().appendingPathExtension("ver"))
            total -= e.size
        }
    }
}
