import Foundation

/// `POST /preview`.
struct Preview: Codable, Hashable {
    let id: String
    var source: String?
    var source_url: String?
    var title: String?
    var artist: String?
    var album: String?
    var remixer: String?
    var year: Int?
    var duration: Double?
    var thumbnail: String?
    var tags: [String]?
    var wikipedia_song: String?
    var wikipedia_artist: String?
    var in_library: Bool?
}

/// `GET /songs/{id}/status`.
struct SongStatus: Codable {
    let status: String
    var progress: Double?
    var error: String?
    var code: String?
    var state: String?
    var error_code: String?

    var isQueued: Bool { status == "queued" || state == "queued" }
    var isConverting: Bool { state == "converting" }

    /// A failed job in words for the person; the server's raw text is only a last resort.
    var failureMessage: String {
        switch error_code ?? code {
        case "preview_only": return "This link is only a preview, so there is no full song to download."
        case "unsupported": return "This link can't be downloaded."
        case "library_full_bytes": return "Your storage is full. Delete some songs to free space."
        case "library_full_songs": return "Your library is full. Delete some songs to add more."
        case "server_full": return "The server is out of storage right now. Try again later."
        case "hourly_limit": return "Hourly limit reached. Try again later."
        default:
            guard let e = error, !e.isEmpty else { return "The download failed. Try again." }
            return "The download failed: \(e)"
        }
    }
}

/// `POST /lookup/wikipedia`.
struct MetadataResult: Decodable {
    var album: String?
    var year: Int?
    var tags: [String]?
    var services: Services?
    var suggest: Suggest?

    enum CodingKeys: String, CodingKey { case album, year, tags, services, suggest }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        album = try? c.decode(String.self, forKey: .album)
        year = try? c.decode(Int.self, forKey: .year)
        tags = try? c.decode([String].self, forKey: .tags)
        services = try? c.decode(Services.self, forKey: .services)
        suggest = try? c.decode(Suggest.self, forKey: .suggest)
    }

    struct Suggest: Decodable, Equatable {
        var artist: String?
        var title: String?
    }

    struct Service: Decodable {
        var found: Bool?
        var url: String?
    }

    struct Services: Decodable {
        var youtube: Service?
        var soundcloud: Service?
        var wikipedia: Service?
        var spotify: Service?
        var musicbrainz: Service?
        var discogs: Service?
    }
}

/// Cover references are stored as a server path (`/covers/<id>`) or an absolute image URL, never with a token.
enum CoverURL {
    static func resolve(_ source: String?, baseURL: String, token: String) -> URL? {
        guard let source, !source.isEmpty else { return nil }
        guard source.hasPrefix("/") else { return URL(string: source) }
        guard var c = URLComponents(string: baseURL), let ref = URLComponents(string: source) else { return nil }
        c.path = ref.path
        var items = ref.queryItems ?? []
        if !token.isEmpty { items.append(.init(name: "token", value: token)) }
        c.queryItems = items.isEmpty ? nil : items
        return c.url
    }

    /// Drops a `token` query from a stored cover; server covers collapse to their path.
    static func scrubbed(_ source: String?) -> String? {
        guard let source, source.contains("token="), var c = URLComponents(string: source) else { return source }
        if c.path.hasPrefix(Endpoints.coversPrefix) { return c.path }
        c.queryItems = c.queryItems?.filter { $0.name != "token" }
        if c.queryItems?.isEmpty == true { c.queryItems = nil }
        return c.string
    }
}

/// `GET /catalog`: every song id and the song records (metadata only).
struct CatalogResponse: Decodable {
    let ids: [String]
    let songs: [ServerSong]

    private enum Keys: String, CodingKey { case ids, songs }
    private enum IDKey: String, CodingKey { case id }
    private struct Lossy: Decodable {
        let song: ServerSong?
        let failure: String?

        init(from decoder: Decoder) throws {
            do {
                song = try ServerSong(from: decoder)
                failure = nil
            } catch {
                song = nil
                let id = (try? decoder.container(keyedBy: IDKey.self).decodeIfPresent(String.self, forKey: .id)).flatMap { $0 } ?? "?"
                failure = "\(id): \(error)"
            }
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        ids = try c.decodeIfPresent([String].self, forKey: .ids) ?? []
        let decoded = try c.decodeIfPresent([Lossy].self, forKey: .songs) ?? []
        for failure in decoded.compactMap(\.failure) { NSLog("catalog: skipped a song that failed to decode: %@", failure) }
        songs = decoded.compactMap(\.song)
    }
}
