import Foundation

enum Endpoints {
    static let defaultServer = secure("play.isayenko.net")
    static let googleAuth = secure("accounts.google.com", "o", "oauth2", "v2", "auth")
    static let googleToken = secure("oauth2.googleapis.com", "token")

    static let tags = path("tags")
    static let catalog = path("catalog")
    static let search = path("search")
    static let download = path("download")
    static let preview = path("preview")
    static let songs = path("songs")
    static let lookupWikipedia = path("lookup", "wikipedia")
    static let metadata = path("metadata")
    static let genres = path("genres")
    static let coversPrefix = path("covers") + "/"

    static func file(_ id: String) -> String { path("files", id) }
    static func song(_ id: String) -> String { path("songs", id) }
    static func songStatus(_ id: String) -> String { path("songs", id, "status") }
    static func songBPMDetect(_ id: String) -> String { path("songs", id, "bpm", "detect") }

    private static func path(_ segments: String...) -> String {
        "/" + segments.joined(separator: "/")
    }

    private static func secure(_ host: String, _ segments: String...) -> String {
        var c = URLComponents()
        c.scheme = "https"
        c.host = host
        c.path = segments.isEmpty ? "" : "/" + segments.joined(separator: "/")
        return c.string ?? ""
    }
}
