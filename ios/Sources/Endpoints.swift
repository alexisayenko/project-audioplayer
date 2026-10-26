import Foundation

enum Endpoints {
    static let defaultServer = secure("electrophone.cc")
    static let legacyServer = secure("play.isayenko.net")
    static let googleAuth = secure("accounts.google.com", "o", "oauth2", "v2", "auth")
    static let googleToken = secure("oauth2.googleapis.com", "token")

    static let tags = path("tags")
    static let catalog = path("catalog")
    static let search = path("search")
    static let download = path("download")
    static let preview = path("preview")
    static let songs = path("songs")
    static let metadata = path("metadata")
    static let genres = path("genres")
    static let statsListening = path("stats", "listening")
    static let plays = path("plays")
    static let coversPrefix = path("covers") + "/"
    static let meUsage = path("me", "usage")
    static let genresGraph = path("genres", "graph")
    static let theoryTerms = path("data", "theory-terms.json")
    static let theoryAnatomy = path("data", "theory-anatomy.json")
    static let wikiSection = path("wiki") + "/"
    static let wikiArticles = secure("en.wikipedia.org", "wiki") + "/"

    static let anonPrefix = path("anon") + "/"
    static let anonSession = path("anon", "session")
    static let anonDownloads = path("anon", "downloads")

    static func anonDownload(_ id: String) -> String { path("anon", "downloads", id) }
    static func anonFile(_ id: String) -> String { path("anon", "downloads", id, "file") }
    static func anonCover(_ id: String) -> String { path("anon", "downloads", id, "cover") }
    static func anonAck(_ id: String) -> String { path("anon", "downloads", id, "ack") }

    static func file(_ id: String) -> String { path("files", id) }
    static func song(_ id: String) -> String { path("songs", id) }
    static func songStatus(_ id: String) -> String { path("songs", id, "status") }
    static func songAudio(_ id: String) -> String { path("songs", id, "audio") }
    static func songCover(_ id: String) -> String { path("songs", id, "cover") }
    static func songCoverFromURL(_ id: String) -> String { path("songs", id, "cover", "from-url") }
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
