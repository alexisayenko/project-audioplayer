import Foundation

/// One place a song comes from (`sources` of a catalog song).
struct SongSource: Codable, Hashable {
    var source: String?
    var id: String?
    var url: String?
}

/// The server's `version` block of a song: what kind of derivation it is (remix, cover, live, ...), shown read-only.
struct SongVersion: Codable, Hashable {
    var type: String?
    var name: String?
    var artists: [String]?
    var releaseYear: Int?
    var originalArtists: [String]?
}

/// A song in the catalog. Its audio may be on the phone (`Documents/audio/<id>.m4a`), on the server only, or nowhere yet.
struct Track: Codable, Identifiable, Hashable {
    let id: String          // YouTube video id
    var title: String
    var artist: String
    var duration: Double?
    var thumbnail: String?   // absolute image URL or server path /covers/<id>; never holds a token
    var album: String?
    var remixer: String?
    var year: Int?
    var tags: [String]?
    var bpm: Double?
    var sourceURL: String?
    var wikipediaSong: String?
    var wikipediaArtist: String?
    var musicbrainzURL: String?
    var addedAt: Date?
    var sources: [SongSource]?
    /// The server holds the audio (`audio_state` "server"). Nil means unknown, treated as yes.
    var onServer: Bool?
    /// The server dropped this song from the catalog while its audio is still on the phone.
    var localOnly: Bool?
    var version: SongVersion?
    var mainArtists: [String]?
    var featuredArtists: [String]?
    var withArtists: [String]?
    var releaseYear: Int?
    var albums: [String]?
    var genres: [String]?
    var remixYear: Int?
    var rawTitle: String?
    var wikipediaAlbum: String?
    var discogsURL: String?

    /// Fills the server-only fields this track lacks from `other`, so a track built from a preview never erases them.
    mutating func inheritDetail(from other: Track) {
        version = version ?? other.version
        mainArtists = mainArtists ?? other.mainArtists
        featuredArtists = featuredArtists ?? other.featuredArtists
        withArtists = withArtists ?? other.withArtists
        releaseYear = releaseYear ?? other.releaseYear
        albums = albums ?? other.albums
        genres = genres ?? other.genres
        remixYear = remixYear ?? other.remixYear
        rawTitle = rawTitle ?? other.rawTitle
        wikipediaAlbum = wikipediaAlbum ?? other.wikipediaAlbum
        discogsURL = discogsURL ?? other.discogsURL
    }

    /// Audio file inside the app's Documents directory.
    var fileURL: URL { LibraryStore.audioDirectory.appendingPathComponent("\(id).m4a") }
}

/// A search hit that has not been downloaded yet.
struct SearchResult: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let artist: String
    let duration: Double?
    let thumbnail: String?
}
