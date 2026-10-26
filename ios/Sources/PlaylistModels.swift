import Foundation

/// One row of `GET /playlists` (API-230).
struct PlaylistSummary: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String?
    var count: Int
    var firstSongID: String?
    var updated: String?

    enum CodingKeys: String, CodingKey {
        case id, name, description, count, updated
        case firstSongID = "first_song_id"
    }

    init(id: String, name: String, description: String? = nil, count: Int = 0, firstSongID: String? = nil, updated: String? = nil) {
        self.id = id
        self.name = name
        self.description = description
        self.count = count
        self.firstSongID = firstSongID
        self.updated = updated
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description)
        count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 0
        firstSongID = try c.decodeIfPresent(String.self, forKey: .firstSongID)
        updated = try c.decodeIfPresent(String.self, forKey: .updated)
    }
}

/// `GET /playlists/{id}` (API-232): the song ids in the playlist's order, never a song field.
struct PlaylistDetail: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String?
    var created: String?
    var updated: String?
    var songs: [String]

    init(id: String, name: String, description: String? = nil, created: String? = nil, updated: String? = nil, songs: [String] = []) {
        self.id = id
        self.name = name
        self.description = description
        self.created = created
        self.updated = updated
        self.songs = songs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description)
        created = try c.decodeIfPresent(String.self, forKey: .created)
        updated = try c.decodeIfPresent(String.self, forKey: .updated)
        songs = try c.decodeIfPresent([String].self, forKey: .songs) ?? []
    }

    var summary: PlaylistSummary {
        PlaylistSummary(id: id, name: name, description: description, count: songs.count, firstSongID: songs.first, updated: updated)
    }
}

struct PlaylistList: Decodable {
    let playlists: [PlaylistSummary]
}

/// `POST /playlists/{id}/songs` (API-235).
struct PlaylistAddResult: Decodable, Equatable {
    var added: Int
    var skipped: [String]

    init(added: Int, skipped: [String]) {
        self.added = added
        self.skipped = skipped
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        added = try c.decodeIfPresent(Int.self, forKey: .added) ?? 0
        skipped = try c.decodeIfPresent([String].self, forKey: .skipped) ?? []
    }

    enum CodingKeys: String, CodingKey { case added, skipped }
}

enum PlaylistLogic {
    static let nameMax = 120

    /// The trimmed name when it is 1 to 120 characters without control characters (PLS-111), else nil.
    static func cleanName(_ raw: String) -> String? {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= nameMax else { return nil }
        guard name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return name
    }

    static func sorted(_ lists: [PlaylistSummary]) -> [PlaylistSummary] {
        lists.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// The list after dragging row `from` to the insertion offset `to` (`onMove` semantics).
    static func moved(_ ids: [String], from: IndexSet, to: Int) -> [String] {
        let source = from.filter { ids.indices.contains($0) }.sorted()
        guard !source.isEmpty else { return ids }
        let moving = source.map { ids[$0] }
        var rest = ids
        for index in source.reversed() { rest.remove(at: index) }
        let target = min(max(to - source.filter { $0 < to }.count, 0), rest.count)
        rest.insert(contentsOf: moving, at: target)
        return rest
    }

    /// The server's full order after the shown songs were rearranged: ids the phone does not show keep their places.
    static func merged(full: [String], shown: [String]) -> [String] {
        let visible = Set(shown)
        var next = shown.makeIterator()
        return full.map { visible.contains($0) ? (next.next() ?? $0) : $0 }
    }

    static func songCount(_ n: Int) -> String { "\(n) \(n == 1 ? "song" : "songs")" }

    /// "12 songs, about 0:48 total" (PLS-121); the length only when some song has one.
    static func totalText(_ songs: [Track]) -> String {
        let count = songCount(songs.count)
        let known = songs.compactMap(\.duration).filter { $0 > 0 }
        guard !known.isEmpty else { return count }
        let minutes = max(1, Int((known.reduce(0, +) / 60).rounded()))
        let clock = "\(minutes / 60):" + String(format: "%02d", minutes % 60)
        return "\(count), \(known.count < songs.count ? "about " : "")\(clock) total"
    }

    /// The toast after "Add to queue": what joined and what did not.
    static func queueNote(added: Int, already: Int, notOnPhone: Int) -> String {
        var parts: [String] = []
        if already > 0 { parts.append("\(already) already in queue") }
        if notOnPhone > 0 { parts.append("\(notOnPhone) not on this iPhone skipped") }
        let extra = parts.isEmpty ? "" : " (" + parts.joined(separator: ", ") + ")"
        return "Added \(songCount(added)) to the queue" + extra
    }

    static func playNote(count: Int, notOnPhone: Int, shuffled: Bool, shuffleWasOn: Bool) -> String {
        var mode = ""
        if shuffled { mode = " (shuffled)" } else if shuffleWasOn { mode = " (shuffle off)" }
        let skipped = notOnPhone > 0 ? ", \(notOnPhone) not on this iPhone skipped" : ""
        return "Playing \(songCount(count))\(mode)\(skipped)"
    }

    static func addedNote(name: String, result: PlaylistAddResult, asked: Int) -> String {
        guard result.added > 0 else { return "Already in the playlist" }
        if asked == 1 { return "Added to \(name)" }
        let dup = result.skipped.isEmpty ? "" : ", \(result.skipped.count) already there"
        return "Added \(songCount(result.added)) to \(name)\(dup)"
    }
}
