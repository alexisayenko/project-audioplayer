import Foundation

/// A song that is downloaded and stored on the device.
struct Track: Codable, Identifiable, Hashable {
    let id: String          // YouTube video id
    var title: String
    var artist: String
    var duration: Double?
    var thumbnail: String?   // absolute image URL or server path /covers/<id>; never holds a token
    var album: String?
    var year: Int?
    var tags: [String]?
    var bpm: Double?
    var sourceURL: String?
    var wikipediaSong: String?
    var wikipediaArtist: String?

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
