import SwiftUI

enum MacPage: String, CaseIterable, Identifiable, Hashable {
    case playback, playlists, library, genresMap, songStats, musicTheory, settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .playback: "Playback"
        case .playlists: "Playlists"
        case .library: "Library"
        case .genresMap: "Genres map"
        case .songStats: "Song stats"
        case .musicTheory: "Music theory"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .playback: "play.circle"
        case .playlists: "music.note"
        case .library: "music.note.list"
        case .genresMap: "circle.hexagongrid"
        case .songStats: "chart.dots.scatter"
        case .musicTheory: "book"
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
