import Foundation

/// Why a guest stream failed, found by asking the server for one byte of the file.
enum StreamProblem: Equatable {
    case limit(minutes: Int)
    case audioDisabled
    case missing
    case network
    case other
}

/// A short message about playback (guest streaming) that the app shows once, with the song's own link when the audio is off.
struct StreamNotice: Identifiable, Equatable {
    let id = UUID()
    let message: String
    var link: URL?
}

/// How the player reaches the owner's public audio when nobody is signed in (ADR-0018). Nil outside guest mode.
struct GuestSource {
    let streamURL: @MainActor (Track) -> URL?
    let diagnose: (Track) async -> StreamProblem
}

enum GuestStream {
    /// `/files/<id>` on the server: anonymous, no `download=1`, no header.
    static func fileURL(baseURL: String, id: String) -> URL? {
        guard isValidID(id), var c = URLComponents(string: baseURL) else { return nil }
        c.path = Endpoints.file(id)
        c.query = nil
        return c.url
    }

    private static func isValidID(_ id: String) -> Bool {
        id != "." && id != ".." && id.range(of: "^[A-Za-z0-9._-]{1,80}$", options: .regularExpression) != nil
    }

    static func diagnose(baseURL: String, id: String) async -> StreamProblem {
        do {
            try await APIClient(baseURL: baseURL, token: "", anonymous: true).probeAudio(id)
            return .other
        } catch APIError.guestLimit(let minutes) {
            return .limit(minutes: minutes)
        } catch APIError.guestAudioDisabled {
            return .audioDisabled
        } catch APIError.http(404, _) {
            return .missing
        } catch is URLError {
            return .network
        } catch APIError.unreachable {
            return .network
        } catch {
            return .other
        }
    }

    static func message(for problem: StreamProblem, title: String, skipping: Bool) -> String {
        let tail = skipping ? " Skipping to the next song." : ""
        switch problem {
        case .limit(let minutes):
            return "Guest listening limit reached. Try again in \(minutes) \(minutes == 1 ? "minute" : "minutes"), or sign in. Songs on this iPhone still play."
        case .audioDisabled:
            return "Audio is switched off for guests right now. Open the song's link instead."
        case .missing:
            return "\"\(title)\" has no audio on the server.\(tail)"
        case .network:
            return "Can't reach the server. Songs on this iPhone still play."
        case .other:
            return "Couldn't stream \"\(title)\".\(tail)"
        }
    }
}
