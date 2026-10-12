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

    init() {
        serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? "http://100.0.0.1:8000"
        token = UserDefaults.standard.string(forKey: "token") ?? ""
    }
}
