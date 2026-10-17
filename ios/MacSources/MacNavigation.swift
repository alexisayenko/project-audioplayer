import SwiftUI

enum MacPage: String, CaseIterable, Identifiable, Hashable {
    case library, playback, settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .library: "Library"
        case .playback: "Playback"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .library: "music.note.list"
        case .playback: "play.circle"
        case .settings: "gearshape"
        }
    }
}

@MainActor
final class MacNavigation: ObservableObject {
    @Published var page: MacPage? = .library
    @Published var showSignIn = false
    @Published var addRequested = false
}
