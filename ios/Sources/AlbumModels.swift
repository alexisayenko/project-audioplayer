import Foundation

/// One track of a stored album (API-250): a title and a length from the source, linked by hand to a library song.
struct AlbumTrack: Codable, Identifiable, Hashable {
    var no: Int
    var title: String
    var durationS: Double?
    var songId: String?
    var disc: Int?

    var id: Int { no }

    init(no: Int, title: String, durationS: Double? = nil, songId: String? = nil, disc: Int? = nil) {
        self.no = no
        self.title = title
        self.durationS = durationS
        self.songId = songId
        self.disc = disc
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        no = try c.decodeIfPresent(Int.self, forKey: .no) ?? 0
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        durationS = try? c.decodeIfPresent(Double.self, forKey: .durationS)
        songId = try? c.decodeIfPresent(String.self, forKey: .songId)
        disc = try? c.decodeIfPresent(Int.self, forKey: .disc)
    }

    enum CodingKeys: String, CodingKey { case no, title, durationS, songId, disc }
}

/// An album of the signed-in user (`GET /albums`, `GET /albums/{id}`).
struct Album: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var artist: String?
    var year: Int?
    var genres: [String]?
    var type: String?
    var coverUrl: String?
    var tracks: [AlbumTrack]
    var created_at: String?

    init(id: String, title: String, artist: String? = nil, year: Int? = nil, genres: [String]? = nil, type: String? = nil,
         coverUrl: String? = nil, tracks: [AlbumTrack] = [], created_at: String? = nil) {
        self.id = id
        self.title = title
        self.artist = artist
        self.year = year
        self.genres = genres
        self.type = type
        self.coverUrl = coverUrl
        self.tracks = tracks
        self.created_at = created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        artist = try c.decodeIfPresent(String.self, forKey: .artist)
        year = try? c.decodeIfPresent(Int.self, forKey: .year)
        genres = try? c.decodeIfPresent([String].self, forKey: .genres)
        type = try? c.decodeIfPresent(String.self, forKey: .type)
        coverUrl = try? c.decodeIfPresent(String.self, forKey: .coverUrl)
        tracks = (try? c.decodeIfPresent([AlbumTrack].self, forKey: .tracks)) ?? []
        created_at = try? c.decodeIfPresent(String.self, forKey: .created_at)
    }

    enum CodingKeys: String, CodingKey { case id, title, artist, year, genres, type, coverUrl, tracks, created_at }
}

enum AlbumSort: String, CaseIterable, Identifiable {
    case added = "Recently added", title = "Title", artist = "Artist", year = "Year", tracks = "Tracks", length = "Length"
    var id: String { rawValue }
}

/// Derived album facts (LIB-224, LIB-231): nothing here is stored on the server or the song.
enum AlbumLogic {
    /// Tracks linked to a song that is still in the library.
    static func linkedCount(_ album: Album, libraryIDs: Set<String>) -> Int {
        album.tracks.filter { $0.songId.map(libraryIDs.contains) ?? false }.count
    }

    /// "In library N of M": a counter beside "On phone N of M", so the two read as one pair; complete (JA) when N equals M.
    static func statusText(_ album: Album, libraryIDs: Set<String>) -> String {
        let total = album.tracks.count
        guard total > 0 else { return "No tracks" }
        return "In library \(linkedCount(album, libraryIDs: libraryIDs)) of \(total)"
    }

    static func isComplete(_ album: Album, libraryIDs: Set<String>) -> Bool {
        !album.tracks.isEmpty && linkedCount(album, libraryIDs: libraryIDs) == album.tracks.count
    }

    /// "On phone N of M": linked tracks whose audio is on the iPhone, out of all tracks.
    static func phoneCount(_ album: Album, phoneIDs: Set<String>) -> Int {
        album.tracks.filter { $0.songId.map(phoneIDs.contains) ?? false }.count
    }

    static func phoneText(_ album: Album, phoneIDs: Set<String>) -> String {
        "On phone \(phoneCount(album, phoneIDs: phoneIDs)) of \(album.tracks.count)"
    }

    /// Everything linked is on the phone (the "On phone" filter, LIB-221).
    static func allLinkedOnPhone(_ album: Album, libraryIDs: Set<String>, phoneIDs: Set<String>) -> Bool {
        let linked = album.tracks.compactMap(\.songId).filter(libraryIDs.contains)
        return !linked.isEmpty && linked.allSatisfy(phoneIDs.contains)
    }

    private static func seconds(_ tracks: [AlbumTrack]) -> [Double] {
        tracks.compactMap(\.durationS).filter { $0.isFinite && $0 >= 0 }
    }

    /// "1 h 04 min", "43 min", "52 s" as the web (`formatTotalLength`).
    static func formatTotalLength(_ sec: Double) -> String {
        let s = Int(sec.rounded())
        if s < 60 { return "\(s) s" }
        let minutes = Int((sec / 60).rounded())
        let hours = minutes / 60
        return hours > 0 ? "\(hours) h " + String(format: "%02d", minutes % 60) + " min" : "\(minutes) min"
    }

    /// The album's total length; "~" when some tracks have no length; nil when none has.
    static func lengthText(_ tracks: [AlbumTrack]) -> String? {
        let known = seconds(tracks)
        let sum = known.reduce(0, +)
        guard sum > 0 else { return nil }
        return (known.count < tracks.count ? "~" : "") + formatTotalLength(sum)
    }

    /// "12 tracks, 1 h 04 min".
    static func summary(_ album: Album) -> String {
        let n = album.tracks.count
        let count = "\(n) \(n == 1 ? "track" : "tracks")"
        return lengthText(album.tracks).map { "\(count), \($0)" } ?? count
    }

    static func byline(_ album: Album) -> String {
        [album.artist ?? "", album.year.map(String.init) ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).trimmingCharacters(in: .whitespaces)
    }

    /// Search over title, artist, genres and track titles (LIB-221).
    static func matches(_ album: Album, query: String) -> Bool {
        let q = fold(query)
        guard !q.isEmpty else { return true }
        let hay = [album.title, album.artist ?? ""] + (album.genres ?? []) + album.tracks.map(\.title)
        return hay.contains { fold($0).contains(q) }
    }

    static func sorted(_ albums: [Album], by sort: AlbumSort, reversed: Bool) -> [Album] {
        let out = albums.sorted { a, b in order(a, b, sort) }
        return reversed ? out.reversed() : out
    }

    private static func order(_ a: Album, _ b: Album, _ sort: AlbumSort) -> Bool {
        switch sort {
        case .added: return (a.created_at ?? "") > (b.created_at ?? "")
        case .title: return fold(a.title) < fold(b.title)
        case .artist:
            let (x, y) = (fold(a.artist ?? ""), fold(b.artist ?? ""))
            return x == y ? fold(a.title) < fold(b.title) : x < y
        case .year: return missingLast(a.year.map(Double.init), b.year.map(Double.init), descending: true)
        case .tracks: return a.tracks.count > b.tracks.count
        case .length: return missingLast(total(a), total(b), descending: true)
        }
    }

    private static func total(_ album: Album) -> Double? {
        let sum = seconds(album.tracks).reduce(0, +)
        return sum > 0 ? sum : nil
    }

    private static func missingLast(_ x: Double?, _ y: Double?, descending: Bool) -> Bool {
        switch (x, y) {
        case let (x?, y?): return descending ? x > y : x < y
        case (_?, nil): return true
        default: return false
        }
    }
}
