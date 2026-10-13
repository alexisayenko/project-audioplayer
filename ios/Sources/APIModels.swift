import Foundation

/// `POST /preview`.
struct Preview: Codable, Hashable {
    let id: String
    var source: String?
    var source_url: String?
    var title: String?
    var artist: String?
    var album: String?
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
}

/// `POST /lookup/wikipedia`.
struct MetadataResult: Decodable {
    var album: String?
    var year: Int?
    var tags: [String]?
    var services: Services?

    struct Service: Decodable {
        var found: Bool?
        var url: String?
    }

    struct Services: Decodable {
        var youtube: Service?
        var soundcloud: Service?
        var wikipedia: Service?
        var spotify: Service?
    }
}

struct WikiLookup: Codable {
    var tags: [String]?
    var year: Int?
}

/// Cover references are stored as a server path (`/covers/<id>`) or an absolute image URL, never with a token.
enum CoverURL {
    static func resolve(_ source: String?, baseURL: String, token: String) -> URL? {
        guard let source, !source.isEmpty else { return nil }
        guard source.hasPrefix("/") else { return URL(string: source) }
        guard var c = URLComponents(string: baseURL) else { return nil }
        c.path = source
        c.queryItems = token.isEmpty ? nil : [.init(name: "token", value: token)]
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
    private struct Lossy: Decodable {
        let song: ServerSong?
        init(from decoder: Decoder) throws { song = try? ServerSong(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        ids = try c.decodeIfPresent([String].self, forKey: .ids) ?? []
        songs = (try c.decodeIfPresent([Lossy].self, forKey: .songs) ?? []).compactMap(\.song)
    }
}
