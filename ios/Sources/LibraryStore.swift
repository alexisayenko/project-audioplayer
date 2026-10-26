import Combine
import CryptoKit
import Foundation
import ImageIO
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The catalog on this iPhone: every song the server lists (cached for offline use) plus the songs whose audio is stored here.
/// A song is "on the phone" when its file exists in `Documents/audio` (named by `AudioFiles`); that is never written to `library.json`,
/// which only holds the id -> file name map.
@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var songs: [Track] = []
    @Published private(set) var phoneIDs: Set<String> = []
    /// ETag of the last catalog the server sent, for `If-None-Match`.
    private(set) var etag: String?
    private var prefetchTask: Task<Void, Never>?
    private var prefetchAgain = false

    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let audioDirectory = AudioFiles.directory
    static let support: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    private static let indexURL = support.appendingPathComponent("library.json")
    private static let legacyIndexURL = documents.appendingPathComponent("library.json")

    /// Bumped when the cached song records gain fields, so the next sync refetches the catalog instead of answering 304.
    private static let schema = 2

    private struct Stored: Codable {
        var etag: String?
        var schema: Int?
        var songs: [Track]
        var files: [String: String]?
    }

    /// Songs whose audio is on this iPhone.
    var tracks: [Track] { songs.filter { phoneIDs.contains($0.id) } }

    init() {
        try? FileManager.default.createDirectory(at: Self.audioDirectory, withIntermediateDirectories: true)
        Self.migrateLegacyIndex()
        if let data = try? Data(contentsOf: Self.indexURL) {
            if let stored = try? JSONDecoder().decode(Stored.self, from: data) {
                songs = stored.songs
                AudioFiles.load(stored.files)
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
        migrateFileNames()
    }

    /// Gives files still named `<id>.m4a` (and files whose song was renamed elsewhere) readable names, off the main thread.
    private func migrateFileNames() {
        let tracks = songs
        Task.detached(priority: .utility) { [weak self] in
            guard AudioFiles.syncAll(tracks) else { return }
            await MainActor.run { self?.fileNamesChanged() }
        }
    }

    private func fileNamesChanged() {
        save()
        refreshPhone()
    }

    func contains(_ id: String) -> Bool { phoneIDs.contains(id) }

    /// Re-reads which audio files exist, so files deleted or renamed in the Files app stop counting as on the phone.
    /// A song counts when its mapped file exists, or, without a map entry, when `<id>.m4a` does.
    func refreshPhone() {
        let ids = Set(songs.filter { FileManager.default.fileExists(atPath: $0.fileURL.path) }.map(\.id))
        if ids != phoneIDs { phoneIDs = ids }
    }

    private static func migrateLegacyIndex() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: legacyIndexURL.path) else { return }
        if !fm.fileExists(atPath: indexURL.path) { try? fm.copyItem(at: legacyIndexURL, to: indexURL) }
        if fm.fileExists(atPath: indexURL.path) { try? fm.removeItem(at: legacyIndexURL) }
    }

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
        AudioFiles.sync(t)
        phoneIDs.insert(t.id)
        save()
        prefetchCovers()
    }

    /// A song added without an account: its file is on the phone and the server never had it in a library.
    func addLocal(_ track: Track) {
        var t = track
        t.localOnly = true
        t.onServer = false
        if let i = songs.firstIndex(where: { $0.id == t.id }) {
            t.addedAt = t.addedAt ?? songs[i].addedAt
            songs[i] = t
        } else {
            t.addedAt = t.addedAt ?? Date()
            songs.insert(t, at: 0)
        }
        AudioFiles.sync(t)
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
        let coverChanged = merged.thumbnail != songs[i].thumbnail
        songs[i] = merged
        AudioFiles.sync(merged)
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
                let base = settings.serverURL
                let token = settings.token
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
        AudioFiles.forget(id)
        phoneIDs.remove(id)
        if songs[i].localOnly == true { songs.remove(at: i); LocalCover.remove(id) }
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
        AudioFiles.forget(id)
        songs.removeAll { $0.id == id }
        phoneIDs.remove(id)
        CoverCache.invalidate(id)
        LocalCover.remove(id)
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
                AudioFiles.forget(prev.id)
            }
        }
        songs = result
        phoneIDs = phoneIDs.intersection(Set(result.map(\.id)))
        for t in result where phoneIDs.contains(t.id) { AudioFiles.sync(t) }
        etag = newTag ?? "synced"
        save()
        for change in coverChanges { coverDidChange(change.id, change.thumbnail) }
        prefetchCovers()
        return appeared.filter { !phoneIDs.contains($0.id) }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(Stored(etag: etag, schema: Self.schema, songs: songs, files: AudioFiles.snapshot(keeping: Set(songs.map(\.id))))) {
            try? data.write(to: Self.indexURL, options: .atomic)
        }
    }
}

extension Notification.Name {
    static let trackThumbnailChanged = Notification.Name("trackThumbnailChanged")
}

/// One shared listener for cover changes; views read `value` so they refresh without each holding a subscription.
@MainActor @Observable
final class CoverEpoch {
    static let shared = CoverEpoch()
    private(set) var value = 0

    private init() {
        NotificationCenter.default.addObserver(forName: .trackThumbnailChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.value += 1 }
        }
    }
}

/// Server covers, kept in memory and on disk (Application Support, excluded from backup) so they show offline.
/// A source is `/covers/<id>`, optionally `?v=<cover_v>`; a different `v` means the cover changed and is fetched again.
/// Files are named by a hash of the id, so no id can reach outside the folder or collide with a marker file.
/// The cache belongs to one server host and account: another one empties it.
/// Memory holds downsampled thumbnails per size bucket; `data(for:)` keeps the full bytes for lock-screen artwork.
enum CoverCache {
    private final class Entry {
        let version: String
        let image: PlatformImage
        let cost: Int
        init(version: String, image: PlatformImage, cost: Int) { self.version = version; self.image = image; self.cost = cost }
    }

    private final class Ref: Sendable {
        let id: String
        let path: String
        let version: String

        init?(_ source: String) {
            guard source.hasPrefix("/"), let c = URLComponents(string: source) else { return nil }
            let parts = c.path.split(separator: "/")
            guard let last = parts.last else { return nil }
            id = parts.count == 3 && parts[0] == "albums" ? "album-" + parts[1] : String(last)
            path = c.path
            version = c.queryItems?.first { $0.name == "v" }?.value ?? ""
        }
    }

    private struct Stored { var version: String? }

    static let thumbnailPixels = 192
    private static let buckets = [192, 640, 1280]
    private static let maxExtraBytes = 50_000_000
    private static let memory: NSCache<NSString, Entry> = {
        let c = NSCache<NSString, Entry>()
        c.totalCostLimit = 48_000_000
        return c
    }()
    private static let refs: NSCache<NSString, Ref> = {
        let c = NSCache<NSString, Ref>()
        c.countLimit = 4000
        return c
    }()
    private static let lock = NSLock()
    private static let ioLock = NSLock()
    nonisolated(unsafe) private static var activeScope: String?
    nonisolated(unsafe) private static var account: String?
    nonisolated(unsafe) private static var accountObserver: AnyCancellable?
    nonisolated(unsafe) private static var hostCache: (base: String, host: String)?
    nonisolated(unsafe) private static var names: [String: String] = [:]
    nonisolated(unsafe) private static var diskIndex: [String: Stored]?

    private static let directory: URL = {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("covers", isDirectory: true)
    }()

    private static func ref(_ source: String) -> Ref? {
        if let hit = refs.object(forKey: source as NSString) { return hit }
        guard let r = Ref(source) else { return nil }
        refs.setObject(r, forKey: source as NSString)
        return r
    }

    private static func name(_ id: String) -> String {
        if let hit = lock.withLock({ names[id] }) { return hit }
        let n = SHA256.hash(data: Data(id.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        lock.withLock { names[id] = n }
        return n
    }

    private static func file(_ id: String) -> URL { directory.appendingPathComponent(name(id) + ".img") }
    private static func versionFile(_ id: String) -> URL { directory.appendingPathComponent(name(id) + ".ver") }
    private static var scopeFile: URL { directory.appendingPathComponent("scope.txt") }

    static func isServerCover(_ source: String?) -> Bool { source?.hasPrefix("/") == true }

    static func bucket(forPixels pixels: CGFloat) -> Int {
        buckets.first { CGFloat($0) >= pixels } ?? buckets[buckets.count - 1]
    }

    private static func prepare() {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: directory.path) else { return }
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        var dir = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
    }

    private static func scopeKeyLocked(_ baseURL: String) -> String? {
        guard let account else { return nil }
        let host: String
        if let c = hostCache, c.base == baseURL { host = c.host } else {
            host = URL(string: baseURL)?.host ?? baseURL
            hostCache = (baseURL, host)
        }
        return host + "|" + account
    }

    private static func scopeReady(_ baseURL: String) -> Bool {
        lock.withLock {
            guard let key = scopeKeyLocked(baseURL), let active = activeScope else { return false }
            return key == active
        }
    }

    @MainActor private static func observedEmail() -> String {
        if lock.withLock({ accountObserver }) == nil {
            let observer = AuthService.shared.$session.sink { s in lock.withLock { account = s?.email ?? "" } }
            lock.withLock { accountObserver = observer }
        }
        return AuthService.shared.session?.email ?? ""
    }

    private static func ensureScope(baseURL: String) async {
        if scopeReady(baseURL) { return }
        if lock.withLock({ account }) == nil {
            let email = await observedEmail()
            lock.withLock { if account == nil { account = email } }
        }
        guard let key = lock.withLock({ scopeKeyLocked(baseURL) }) else { return }
        switchScope(to: key)
    }

    private static func switchScope(to scope: String) {
        ioLock.withLock {
            let current = lock.withLock { activeScope } ?? (try? String(contentsOf: scopeFile, encoding: .utf8))
            if current == scope {
                lock.withLock { activeScope = scope }
                return
            }
            try? FileManager.default.removeItem(at: directory)
            prepare()
            try? scope.write(to: scopeFile, atomically: true, encoding: .utf8)
            lock.withLock {
                memory.removeAllObjects()
                activeScope = scope
                diskIndex = [:]
            }
        }
    }

    private static func buildIndex() -> [String: Stored] {
        var index: [String: Stored] = [:]
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for url in files where url.pathExtension == "img" {
            let n = url.deletingPathExtension().lastPathComponent
            let ver = try? String(contentsOf: directory.appendingPathComponent(n + ".ver"), encoding: .utf8)
            index[n] = Stored(version: ver)
        }
        return index
    }

    private static func index() async -> [String: Stored] {
        if let ready = lock.withLock({ diskIndex }) { return ready }
        return await Task.detached(priority: .utility) {
            publishIndex(loadIndex())
        }.value
    }

    private static func loadIndex() -> [String: Stored] {
        ioLock.withLock { lock.withLock { diskIndex } ?? buildIndex() }
    }

    private static func publishIndex(_ built: [String: Stored]) -> [String: Stored] {
        lock.withLock { () -> [String: Stored] in
            if let ready = diskIndex { return ready }
            diskIndex = built
            return built
        }
    }

    private static func setStored(_ n: String, _ stored: Stored?) async {
        _ = await index()
        lock.withLock { if var index = diskIndex { index[n] = stored; diskIndex = index } }
    }

    private static func isCached(_ ref: Ref) async -> Bool {
        let n = name(ref.id)
        guard let stored = await index()[n] else { return false }
        return ref.version.isEmpty || stored.version == ref.version
    }

    private static func isImage(_ data: Data) -> Bool {
        guard let src = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(src) > 0,
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              props[kCGImagePropertyPixelWidth] != nil else { return false }
        return true
    }

    private static func thumbnail(from data: Data, maxPixel: Int) -> (image: PlatformImage, cost: Int)? {
        guard let src = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        var limit = maxPixel
        if let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
           let w = props[kCGImagePropertyPixelWidth] as? Int, let h = props[kCGImagePropertyPixelHeight] as? Int {
            limit = min(maxPixel, max(w, h))
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: limit
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, options as CFDictionary) else { return nil }
        let cost = cg.width * cg.height * 4
        #if os(iOS)
        return (UIImage(cgImage: cg), cost)
        #else
        return (NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height)), cost)
        #endif
    }

    private static func memoryKey(_ id: String, _ pixels: Int) -> NSString { "\(id)@\(pixels)" as NSString }

    private static func memoryHit(_ ref: Ref, pixels: Int) -> PlatformImage? {
        guard let hit = memory.object(forKey: memoryKey(ref.id, pixels)), hit.version == ref.version || ref.version.isEmpty else { return nil }
        return hit.image
    }

    /// The sources whose current cover is not stored yet.
    static func missing(_ sources: [String], baseURL: String) async -> [String] {
        await ensureScope(baseURL: baseURL)
        var out: [String] = []
        for s in sources {
            if let r = ref(s), !(await isCached(r)) { out.append(s) }
        }
        return out
    }

    /// The cover bytes: from disk when the stored version matches, else fetched; a failed fetch falls back to the stored copy.
    static func data(for source: String, baseURL: String, token: String) async -> Data? {
        guard let ref = ref(source) else { return nil }
        await ensureScope(baseURL: baseURL)
        if await isCached(ref), let stored = try? Data(contentsOf: file(ref.id)) { return stored }
        if let fresh = try? await APIClient(baseURL: baseURL, token: token).fetch(ref.path), isImage(fresh) {
            prepare()
            try? fresh.write(to: file(ref.id), options: .atomic)
            try? ref.version.write(to: versionFile(ref.id), atomically: true, encoding: .utf8)
            await setStored(name(ref.id), Stored(version: ref.version))
            return fresh
        }
        return try? Data(contentsOf: file(ref.id))
    }

    /// A downsampled cover already in memory, without any waiting; nil when it has to be loaded.
    static func cached(_ source: String, baseURL: String, pixels: Int = thumbnailPixels) -> PlatformImage? {
        guard scopeReady(baseURL), let ref = ref(source) else { return nil }
        return memoryHit(ref, pixels: pixels)
    }

    /// A cover downsampled to at most `pixels` on its long side, decoded off the main thread.
    static func image(for source: String, baseURL: String, token: String, pixels: Int = thumbnailPixels) async -> PlatformImage? {
        guard let ref = ref(source) else { return nil }
        if scopeReady(baseURL), let hit = memoryHit(ref, pixels: pixels) { return hit }
        return await Task.detached(priority: .userInitiated) { () -> PlatformImage? in
            await ensureScope(baseURL: baseURL)
            if let hit = memoryHit(ref, pixels: pixels) { return hit }
            guard let data = await data(for: source, baseURL: baseURL, token: token),
                  let thumb = thumbnail(from: data, maxPixel: pixels) else { return nil }
            memory.setObject(Entry(version: ref.version, image: thumb.image, cost: thumb.cost), forKey: memoryKey(ref.id, pixels), cost: thumb.cost)
            return thumb.image
        }.value
    }

    static func invalidate(_ id: String) {
        for pixels in buckets { memory.removeObject(forKey: memoryKey(id, pixels)) }
        try? FileManager.default.removeItem(at: file(id))
        try? FileManager.default.removeItem(at: versionFile(id))
        let n = name(id)
        lock.withLock { if var index = diskIndex { index[n] = nil; diskIndex = index } }
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
            let n = e.url.deletingPathExtension().lastPathComponent
            lock.withLock { if var index = diskIndex { index[n] = nil; diskIndex = index } }
            total -= e.size
        }
    }
}
