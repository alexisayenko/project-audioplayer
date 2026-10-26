import Foundation

/// Names of the audio files in `Documents/audio`, so the Files app shows "Artist - Title.m4a" instead of "<id>.m4a".
/// The id -> file name map is kept in `library.json` and in `phone-index.json` (`LibraryIndex`); an id without an entry uses the legacy name `<id>.m4a`.
/// Every read and write of the map, and every move of a file, happens under one lock, so a path never points at a half-renamed file.
enum AudioFiles {
    private static let ext = "m4a"
    private static let maxBase = 120
    private static let maxCollisions = 1000
    private static let maxAdoptScan = 20
    private static let lock = NSLock()
    nonisolated(unsafe) private static var names: [String: String] = [:]

    static let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("audio", isDirectory: true)

    private static func legacyName(_ id: String) -> String { "\(id).\(ext)" }

    static func url(for id: String) -> URL {
        let name = lock.withLock { names[id] } ?? legacyName(id)
        return directory.appendingPathComponent(name)
    }

    static func load(_ map: [String: String]?) {
        let valid = (map ?? [:]).filter { !$0.value.isEmpty && !$0.value.contains("/") && $0.value.hasSuffix("." + ext) }
        lock.withLock { names = valid }
    }

    static func snapshot(keeping ids: Set<String>) -> [String: String] {
        lock.withLock { names.filter { ids.contains($0.key) } }
    }

    static func forget(_ id: String) {
        lock.withLock { names[id] = nil }
    }

    /// "Artist - Title", or just the title without an artist; nil without a usable title.
    static func baseName(title: String, artist: String) -> String? {
        let t = clean(title)
        guard !t.isEmpty else { return nil }
        let a = clean(artist)
        let joined = a.isEmpty ? t : "\(a) - \(t)"
        return trim(String(joined.prefix(maxBase)))
    }

    /// Strips characters a file system or the Files app dislikes, turns every whitespace run into one space, trims dots and spaces.
    static func clean(_ s: String) -> String {
        let banned = CharacterSet(charactersIn: "/:\\?*\"<>|").union(.controlCharacters).union(.illegalCharacters)
        var out = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            if CharacterSet.whitespacesAndNewlines.contains(u) { out.append(" ") }
            else if !banned.contains(u) { out.append(u) }
        }
        let collapsed = String(out).split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        return trim(collapsed)
    }

    private static func trim(_ s: String) -> String {
        s.trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespacesAndNewlines))
    }

    private static func fold(_ s: String) -> String { s.precomposedStringWithCanonicalMapping.lowercased() }

    /// True when `stem` is `base` or `base (n)`, so a name that already got a collision suffix stays put.
    private static func matches(stem: String, base: String) -> Bool {
        let s = fold(stem)
        let b = fold(base)
        if s == b { return true }
        guard s.hasPrefix(b + " ("), s.hasSuffix(")") else { return false }
        return Int(s.dropFirst(b.count + 2).dropLast()) != nil
    }

    private static func stem(_ name: String) -> String { (name as NSString).deletingPathExtension }

    /// The first of `base`, `base (2)`, `base (3)`... that no other song owns and no file occupies. Call under the lock.
    private static func freeName(_ base: String, for id: String) -> String? {
        let taken = Set(names.filter { $0.key != id }.values.map(fold))
        let fm = FileManager.default
        for n in 1...maxCollisions {
            let candidate = (n == 1 ? base : "\(base) (\(n))") + "." + ext
            if taken.contains(fold(candidate)) { continue }
            if fm.fileExists(atPath: directory.appendingPathComponent(candidate).path) { continue }
            return candidate
        }
        return nil
    }

    /// Where a song's audio is to be written: its mapped file, the legacy file if that exists, else a new readable name.
    /// Songs without a usable title keep `<id>.m4a` and are renamed by `sync` once they have one.
    static func reserve(_ track: Track) -> URL {
        lock.withLock {
            if let n = names[track.id] { return directory.appendingPathComponent(n) }
            let legacy = directory.appendingPathComponent(legacyName(track.id))
            guard let base = baseName(title: track.title, artist: track.artist),
                  !FileManager.default.fileExists(atPath: legacy.path),
                  let name = freeName(base, for: track.id) else { return legacy }
            names[track.id] = name
            return directory.appendingPathComponent(name)
        }
    }

    /// Renames the song's file to match its current artist and title; true when the name changed.
    /// Does nothing for a song with no file and no map entry, without a usable title, or whose name already fits.
    /// A failed move leaves everything as it was.
    @discardableResult
    static func sync(_ track: Track) -> Bool {
        guard let base = baseName(title: track.title, artist: track.artist) else { return false }
        let fm = FileManager.default
        return lock.withLock {
            let mapped = names[track.id]
            let current = mapped ?? legacyName(track.id)
            let from = directory.appendingPathComponent(current)
            let present = fm.fileExists(atPath: from.path)
            if mapped == nil && !present { return false }
            if matches(stem: stem(current), base: base) { return false }
            guard let name = freeName(base, for: track.id) else { return false }
            if present {
                do { try fm.moveItem(at: from, to: directory.appendingPathComponent(name)) } catch { return false }
            }
            names[track.id] = name
            return true
        }
    }

    /// Gives back the map entries lost with the index: a song with no entry and no legacy file gets the file that is named for its artist and title
    /// (`base`, `base (2)`, ...) when it exists in `dir` and no other song owns it. True when an entry was added.
    @discardableResult
    static func adopt(_ tracks: [Track], in dir: URL = directory) -> Bool {
        let fm = FileManager.default
        return lock.withLock {
            var changed = false
            for t in tracks where names[t.id] == nil {
                guard !fm.fileExists(atPath: dir.appendingPathComponent(legacyName(t.id)).path),
                      let base = baseName(title: t.title, artist: t.artist) else { continue }
                let taken = Set(names.values.map(fold))
                for n in 1...maxAdoptScan {
                    let candidate = (n == 1 ? base : "\(base) (\(n))") + "." + ext
                    guard !taken.contains(fold(candidate)), fm.fileExists(atPath: dir.appendingPathComponent(candidate).path) else { continue }
                    names[t.id] = candidate
                    changed = true
                    break
                }
            }
            return changed
        }
    }

    @discardableResult
    static func syncAll(_ tracks: [Track]) -> Bool {
        var changed = false
        for t in tracks where sync(t) { changed = true }
        return changed
    }
}
