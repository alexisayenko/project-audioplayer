import Combine
import Foundation

/// Listening statistics are optional: local playback never waits for this request.
@MainActor
final class ListeningStore: ObservableObject {
    @Published private(set) var entries: [String: LibraryListeningEntry] = [:]
    @Published private(set) var loaded = false
    private var generation = 0

    func load(settings: Settings, signedIn: Bool, reset: Bool = false) async {
        generation += 1
        let request = generation
        if reset || !signedIn { entries = [:]; loaded = false }
        guard signedIn else { return }
        struct Payload: Decodable { var songs: [String: LibraryListeningEntry]? }
        do {
            let data = try await APIClient(baseURL: settings.serverURL, token: settings.token).fetch(Endpoints.statsListening)
            let payload = try JSONDecoder().decode(Payload.self, from: data)
            guard request == generation, !Task.isCancelled else { return }
            entries = payload.songs ?? [:]; loaded = true
        } catch {
            guard request == generation else { return }
            entries = [:]; loaded = false
        }
    }
}
