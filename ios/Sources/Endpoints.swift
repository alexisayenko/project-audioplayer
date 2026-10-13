import Foundation

enum Endpoints {
    static let defaultServer = "https://play.isayenko.net"
    static let googleAuth = "https://accounts.google.com/o/oauth2/v2/auth"
    static let googleToken = "https://oauth2.googleapis.com/token"

    static let tags = "/tags"
    static let catalog = "/catalog"
    static let search = "/search"
    static let download = "/download"
    static let preview = "/preview"
    static let songs = "/songs"
    static let lookupWikipedia = "/lookup/wikipedia"
    static let metadata = "/metadata"
    static let coversPrefix = "/covers/"

    static func file(_ id: String) -> String { "/files/\(id)" }
    static func song(_ id: String) -> String { "/songs/\(id)" }
    static func songStatus(_ id: String) -> String { "/songs/\(id)/status" }
    static func songBPMDetect(_ id: String) -> String { "/songs/\(id)/bpm/detect" }
}
