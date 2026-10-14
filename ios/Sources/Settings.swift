import Foundation

/// Server location, a legacy API token (sign-in is Google or Apple, IOS-011) and the download switches. Kept in UserDefaults.
final class Settings: ObservableObject {
    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "serverURL") }
    }
    @Published var token: String {
        didSet { UserDefaults.standard.set(token, forKey: "token") }
    }

    static let defaultServerURL = Endpoints.defaultServer

    var hasCustomConnection: Bool { serverURL != Self.defaultServerURL || !token.isEmpty }

    var customServerLabel: String {
        serverURL == Self.defaultServerURL ? "legacy token" : (URL(string: serverURL)?.host(percentEncoded: false) ?? serverURL)
    }

    func resetConnection() {
        serverURL = Self.defaultServerURL
        token = ""
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
        let stored = UserDefaults.standard.string(forKey: "serverURL")
        let isLegacy = stored.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == Endpoints.legacyServer } ?? false
        let resolved = (stored == nil || isLegacy) ? Self.defaultServerURL : stored!
        if isLegacy { UserDefaults.standard.set(resolved, forKey: "serverURL") }
        serverURL = resolved
        token = UserDefaults.standard.string(forKey: "token") ?? ""
        UserDefaults.standard.set(token, forKey: "token")
    }
}
