import Foundation

enum LibrarySort: String, CaseIterable, Identifiable {
    case newest = "Recently added", title = "Title", artist = "Artist", year = "Year"
    case bpm = "BPM", length = "Length", listened = "Last listened"
    var id: String { rawValue }
    var descending: Bool { [.newest, .year, .listened].contains(self) }
    var symbol: String {
        switch self {
        case .newest: "clock"
        case .title: "textformat"
        case .artist: "person"
        case .year: "calendar"
        case .bpm: "metronome"
        case .length: "timer"
        case .listened: "headphones"
        }
    }
}

/// Separate from FilterCategory: the Mac still uses the older filter model.
enum LibraryFacet: String, CaseIterable, Identifiable {
    case tags = "Tags", genres = "Genres", era = "Era", countries = "Countries"
    var id: String { rawValue }
    var title: String { self == .era ? "Decades" : rawValue }
    var prefix: String {
        switch self {
        case .tags: "tags:"
        case .genres: "genre:"
        case .era: "era:"
        case .countries: "country:"
        }
    }
    var symbol: String {
        switch self {
        case .tags: "tag"
        case .genres: "music.quarternote.3"
        case .era: "calendar"
        case .countries: "globe"
        }
    }
    var noun: String {
        switch self {
        case .tags: "tag"
        case .genres: "genre"
        case .era: "decade"
        case .countries: "country"
        }
    }
    func noun(_ n: Int) -> String {
        if n == 1 { return noun }
        return self == .countries ? "countries" : noun + "s"
    }
    var unknown: String { prefix + "__unset__" }

    func keys(_ song: Track) -> Set<String> {
        if self == .era {
            return Set([song.libraryYear.map { prefix + String(($0 / 10) * 10) } ?? unknown])
        }
        var keys: Set<String> = []
        for tag in song.tags ?? [] {
            let part = splitTag(tag)
            let key = part.key.lowercased()
            switch self {
            case .tags:
                if !["genre", "decade", "country", "lang"].contains(key) { keys.insert(prefix + tag.lowercased()) }
            case .genres:
                if key == "genre", !part.value.isEmpty { keys.insert(prefix + part.value.lowercased()) }
            case .countries:
                if key == "country", !part.value.isEmpty { keys.insert(prefix + part.value.lowercased()) }
            case .era: break
            }
        }
        if self == .genres {
            keys.formUnion((song.genres ?? []).filter { !$0.isEmpty }.map { prefix + $0.lowercased() })
        }
        if keys.isEmpty && self != .tags { keys.insert(unknown) }
        return keys
    }

    func label(_ key: String) -> String {
        if key == unknown { return "Unknown" }
        let value = String(key.dropFirst(prefix.count))
        if self == .era, let year = Int(value) { return String(format: "’%02ds", (year % 100 + 100) % 100) }
        return self == .tags ? tagLabel(value) : tagLabel(key)
    }

    func values(_ songs: [Track]) -> [LibraryFacetValue] {
        var counts: [String: Int] = [:]
        var labels: [String: String] = [:]
        for song in songs {
            for key in keys(song) { counts[key, default: 0] += 1 }
            for tag in song.tags ?? [] {
                let part = splitTag(tag)
                if self == .tags && !["genre", "decade", "country", "lang"].contains(part.key.lowercased()) {
                    let key = prefix + tag.lowercased()
                    labels[key] = labels[key] ?? tagLabel(tag)
                } else if self == .genres && part.key.lowercased() == "genre" {
                    let key = prefix + part.value.lowercased()
                    labels[key] = labels[key] ?? part.value
                }
            }
            if self == .genres {
                for genre in song.genres ?? [] {
                    let key = prefix + genre.lowercased()
                    labels[key] = labels[key] ?? genre
                }
            }
        }
        return counts.map { LibraryFacetValue(id: $0.key, label: labels[$0.key] ?? label($0.key), count: $0.value) }.sorted {
            if $0.id == unknown { return false }
            if $1.id == unknown { return true }
            if self == .era {
                return (Int($0.id.dropFirst(prefix.count)) ?? 0) > (Int($1.id.dropFirst(prefix.count)) ?? 0)
            }
            return $0.count == $1.count ? LibraryMatching.compare($0.label, $1.label) == .orderedAscending : $0.count > $1.count
        }
    }
}

struct LibraryFacetValue: Identifiable {
    let id: String
    let label: String
    let count: Int
}

struct LibraryListeningEntry: Decodable {
    struct Counts: Decodable { var all: Int? }
    var listened: Counts?
    var skipped: Counts?
    var totalListenedS: Double?
    var lastListened: String?
    var never: Bool { (listened?.all ?? 0) + (skipped?.all ?? 0) == 0 }
    enum CodingKeys: String, CodingKey {
        case listened, skipped
        case totalListenedS = "total_listened_s", lastListened = "last_listened"
    }
}

enum LibraryMatching {
    static func folded(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }
    static func compare(_ a: String, _ b: String) -> ComparisonResult { folded(a).compare(folded(b)) }

    static func filtered(_ songs: [Track], search: String, selection: Set<String>, neverListened: Bool,
                         downloadedOnly: Bool, phoneIDs: Set<String>,
                         listening: [String: LibraryListeningEntry]) -> [Track] {
        let q = folded(search.trimmingCharacters(in: .whitespacesAndNewlines))
        let groups = LibraryFacet.allCases.map { facet in
            (facet, Set(selection.filter { $0.hasPrefix(facet.prefix) }))
        }
        return songs.filter { song in
            if downloadedOnly && !phoneIDs.contains(song.id) { return false }
            if neverListened && !(listening[song.id]?.never ?? true) { return false }
            for (facet, picked) in groups where !picked.isEmpty {
                if facet.keys(song).isDisjoint(with: picked) { return false }
            }
            return q.isEmpty || song.librarySearchTerms.contains { folded($0).contains(q) }
        }
    }

    static func sorted(_ songs: [Track], sort: LibrarySort, reversed: Bool,
                       listening: [String: LibraryListeningEntry]) -> [Track] {
        songs.sorted { a, b in
            let result: ComparisonResult
            switch sort {
            case .title: result = compare(a.title, b.title)
            case .artist: result = optionalCompare(a.librarySortArtist, b.librarySortArtist, reversed: reversed, descending: false)
            case .newest: result = optionalCompare(a.addedAt, b.addedAt, reversed: reversed, descending: true)
            case .year: result = optionalCompare(a.libraryYear, b.libraryYear, reversed: reversed, descending: true)
            case .bpm: result = optionalCompare(a.bpm.flatMap { $0.isFinite ? $0 : nil }, b.bpm.flatMap { $0.isFinite ? $0 : nil }, reversed: reversed, descending: false)
            case .length: result = optionalCompare(a.duration.flatMap { $0 > 0 && $0.isFinite ? $0 : nil }, b.duration.flatMap { $0 > 0 && $0.isFinite ? $0 : nil }, reversed: reversed, descending: false)
            case .listened: result = optionalCompare(listening[a.id]?.lastListened, listening[b.id]?.lastListened, reversed: reversed, descending: true)
            }
            var order = result
            // Optional keys already apply direction while keeping missing values last.
            if sort == .title && reversed { order = inverse(order) }
            if order == .orderedSame { order = compare(a.title, b.title) }
            return order == .orderedSame ? a.id < b.id : order == .orderedAscending
        }
    }

    private static func inverse(_ order: ComparisonResult) -> ComparisonResult {
        switch order {
        case .orderedAscending: .orderedDescending
        case .orderedDescending: .orderedAscending
        case .orderedSame: .orderedSame
        }
    }
    private static func optionalCompare<T: Comparable>(_ a: T?, _ b: T?, reversed: Bool, descending: Bool) -> ComparisonResult {
        guard let a else { return b == nil ? .orderedSame : .orderedDescending }
        guard let b else { return .orderedAscending }
        let result: ComparisonResult
        if a == b { result = .orderedSame }
        else { result = a < b ? .orderedAscending : .orderedDescending }
        return descending != reversed ? inverse(result) : result
    }
}

extension Track {
    /// Match web credits.js: remasters retain their original release year.
    var libraryYear: Int? {
        let original = releaseYear ?? year
        return version?.type?.lowercased() == "remaster" ? original : version?.releaseYear ?? remixYear ?? original
    }
    var libraryArtist: String {
        guard let mainArtists else { return artist }
        var parts = [mainArtists.joined(separator: " & ")]
        if let featuredArtists, !featuredArtists.isEmpty { parts.append("feat. " + featuredArtists.joined(separator: " & ")) }
        if let withArtists, !withArtists.isEmpty { parts.append("with " + withArtists.joined(separator: " & ")) }
        return parts.filter { !$0.isEmpty }.joined(separator: " ")
    }
    var librarySortArtist: String? {
        let text = (mainArtists?.first ?? artist).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : LibraryMatching.folded(text)
    }
    var librarySubtitle: String { [libraryArtist, libraryYear.map(String.init) ?? ""].filter { !$0.isEmpty }.joined(separator: " · ") }
    var librarySearchTerms: [String] {
        var terms = [title, artist, album ?? "", remixer ?? "", version?.name ?? ""]
        terms.append(contentsOf: mainArtists ?? [])
        terms.append(contentsOf: featuredArtists ?? [])
        terms.append(contentsOf: withArtists ?? [])
        terms.append(contentsOf: version?.artists ?? [])
        terms.append(contentsOf: albums ?? [])
        terms.append(contentsOf: genres ?? [])
        terms.append(contentsOf: (tags ?? []).flatMap { [$0, tagLabel($0)] })
        return terms
    }
}
