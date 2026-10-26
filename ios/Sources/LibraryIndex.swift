import Foundation
import os

private let indexLog = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.alexisayenko.audioplayer", category: "library-index")

/// The song index on the device: the cached server catalog (`library.json`) and, beside it, the device state that offline playback needs
/// (`phone-index.json`: the id -> file name map and the records of the songs whose audio is on the phone).
/// A catalog that cannot be decoded is kept as `library.json.corrupt-<stamp>`, the last good copy (`library.json.good`) or the phone
/// index stands in for it, and a single unreadable song record is dropped instead of the whole file, so audio already on the phone stays playable without a network sync.
struct LibraryIndex {
    let catalogURL: URL
    let phoneURL: URL

    static let schema = 2
    private static let keptCorruptCopies = 3

    var goodURL: URL { catalogURL.appendingPathExtension("good") }

    struct Loaded {
        var songs: [Track] = []
        var files: [String: String] = [:]
        var etag: String?
        var recovered = false
    }

    private struct Lossy<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }

    private struct Catalog: Codable {
        var etag: String?
        var schema: Int?
        var songs: [Track]
        var files: [String: String]?
        var dropped = 0

        private enum CodingKeys: String, CodingKey { case etag, schema, songs, files }

        init(etag: String?, schema: Int?, songs: [Track], files: [String: String]?) {
            self.etag = etag
            self.schema = schema
            self.songs = songs
            self.files = files
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            etag = try c.decodeIfPresent(String.self, forKey: .etag)
            schema = try c.decodeIfPresent(Int.self, forKey: .schema)
            files = try c.decodeIfPresent([String: String].self, forKey: .files)
            let all = try c.decode([Lossy<Track>].self, forKey: .songs)
            songs = all.compactMap(\.value)
            dropped = all.count - songs.count
        }
    }

    private struct Phone: Codable {
        var version = 1
        var files: [String: String]
        var songs: [Track]

        private enum CodingKeys: String, CodingKey { case version, files, songs }

        init(files: [String: String], songs: [Track]) {
            self.files = files
            self.songs = songs
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
            files = try c.decodeIfPresent([String: String].self, forKey: .files) ?? [:]
            songs = try c.decode([Lossy<Track>].self, forKey: .songs).compactMap(\.value)
        }
    }

    private enum Read<T> {
        case missing, corrupt, ok(T)
    }

    private func read<T>(_ url: URL, _ parse: (Data) throws -> T) -> Read<T> {
        guard FileManager.default.fileExists(atPath: url.path) else { return .missing }
        do {
            return .ok(try parse(Data(contentsOf: url)))
        } catch {
            indexLog.error("cannot read \(url.lastPathComponent, privacy: .public): \(String(describing: error), privacy: .public)")
            return .corrupt
        }
    }

    private func readCatalog(_ url: URL) -> Read<Catalog> {
        read(url) { data in
            if let catalog = try? JSONDecoder().decode(Catalog.self, from: data) { return catalog }
            let legacy = try JSONDecoder().decode([Lossy<Track>].self, from: data)
            let songs = legacy.compactMap(\.value)
            var catalog = Catalog(etag: nil, schema: nil, songs: songs, files: nil)
            catalog.dropped = legacy.count - songs.count
            return catalog
        }
    }

    func load() -> Loaded {
        var out = Loaded()
        var catalog: Catalog?
        switch readCatalog(catalogURL) {
        case .ok(let c): catalog = c
        case .missing: break
        case .corrupt:
            quarantine(catalogURL)
            out.recovered = true
            if case .ok(let c) = readCatalog(goodURL) {
                catalog = c
                indexLog.notice("library.json restored from the last good copy")
            }
        }
        var phone: Phone?
        switch read(phoneURL, { try JSONDecoder().decode(Phone.self, from: $0) }) {
        case .ok(let p): phone = p
        case .missing: break
        case .corrupt:
            quarantine(phoneURL)
            out.recovered = true
        }
        out.songs = catalog?.songs ?? []
        out.files = catalog?.files ?? [:]
        if let phone {
            out.files.merge(phone.files) { _, fromPhone in fromPhone }
            if out.recovered || catalog == nil {
                let have = Set(out.songs.map(\.id))
                let missing = phone.songs.filter { !have.contains($0.id) }
                out.songs += missing
                if !missing.isEmpty { out.recovered = true }
            }
        }
        if let catalog, catalog.dropped > 0 { out.recovered = true }
        if let catalog, !out.recovered, catalog.schema == Self.schema { out.etag = catalog.etag }
        if !out.recovered, !out.songs.isEmpty { refreshGoodCopy() }
        return out
    }

    func save(etag: String?, songs: [Track], files: [String: String], phoneIDs: Set<String>) {
        let catalog = Catalog(etag: etag, schema: Self.schema, songs: songs, files: files)
        let phone = Phone(files: files.filter { phoneIDs.contains($0.key) }, songs: songs.filter { phoneIDs.contains($0.id) })
        write(catalog, to: catalogURL)
        write(phone, to: phoneURL)
    }

    private func write<T: Encodable>(_ value: T, to url: URL) {
        do {
            try JSONEncoder().encode(value).write(to: url, options: .atomic)
        } catch {
            indexLog.error("cannot write \(url.lastPathComponent, privacy: .public): \(String(describing: error), privacy: .public)")
        }
    }

    private func refreshGoodCopy() {
        let fm = FileManager.default
        let tmp = goodURL.appendingPathExtension("tmp")
        try? fm.removeItem(at: tmp)
        do {
            try fm.copyItem(at: catalogURL, to: tmp)
            try? fm.removeItem(at: goodURL)
            try fm.moveItem(at: tmp, to: goodURL)
        } catch {
            try? fm.removeItem(at: tmp)
            indexLog.error("cannot refresh the last good copy: \(String(describing: error), privacy: .public)")
        }
    }

    private func quarantine(_ url: URL) {
        let fm = FileManager.default
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withYear, .withMonth, .withDay, .withTime]
        let copy = url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent).corrupt-\(formatter.string(from: Date()))")
        if !fm.fileExists(atPath: copy.path) {
            do { try fm.copyItem(at: url, to: copy) } catch {
                indexLog.error("cannot keep a copy of \(url.lastPathComponent, privacy: .public): \(String(describing: error), privacy: .public)")
            }
        }
        let prefix = url.lastPathComponent + ".corrupt-"
        let names = ((try? fm.contentsOfDirectory(atPath: url.deletingLastPathComponent().path)) ?? []).filter { $0.hasPrefix(prefix) }.sorted()
        for old in names.dropLast(Self.keptCorruptCopies) {
            try? fm.removeItem(at: url.deletingLastPathComponent().appendingPathComponent(old))
        }
    }
}
