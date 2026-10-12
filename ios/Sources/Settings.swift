import Foundation

/// Server location and token. Kept in UserDefaults: this is a single-user
/// TestFlight app and the token only guards a private server.
final class Settings: ObservableObject {
    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "serverURL") }
    }
    @Published var token: String {
        didSet { UserDefaults.standard.set(token, forKey: "token") }
    }

    static let useMobileDataKey = "useMobileData"

    /// Downloads over cellular. Off by default: songs copy over Wi-Fi unless this is on.
    @Published var useMobileData: Bool {
        didSet { UserDefaults.standard.set(useMobileData, forKey: Self.useMobileDataKey) }
    }

    /// Whether a song saved from the Add sheet is also copied to this iPhone. On by default.
    @Published var downloadNewAutomatically: Bool {
        didSet { UserDefaults.standard.set(downloadNewAutomatically, forKey: "downloadNewAutomatically") }
    }

    init() {
        downloadNewAutomatically = UserDefaults.standard.object(forKey: "downloadNewAutomatically") as? Bool ?? true
        useMobileData = UserDefaults.standard.bool(forKey: Self.useMobileDataKey)
        serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? "https://play.isayenko.net"
        token = UserDefaults.standard.string(forKey: "token") ?? ""
        UserDefaults.standard.set(token, forKey: "token")
    }
}
