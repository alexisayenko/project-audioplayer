import SwiftUI

@main
struct AudioPlayerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var library = LibraryStore()
    @StateObject private var player = PlayerService()
    @StateObject private var settings = Settings()
    @StateObject private var server = ServerLink()
    @StateObject private var anon = AnonDownloader()
    @StateObject private var libraryQuery = LibraryQuery()
    @StateObject private var listening = ListeningStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(player)
                .environmentObject(player.clock)
                .environmentObject(settings)
                .environmentObject(server)
                .environmentObject(server.board)
                .environmentObject(anon)
                .environmentObject(libraryQuery)
                .environmentObject(listening)
                .task {
                    player.artworkServer = { [settings] in ArtworkServer(base: settings.serverURL, token: settings.token) }
                    player.shuffleCounts = { [listening] in listening.recentCounts }
                    PlaybackPersistence.shared.install(player: player, library: library) { [library] in library.contains($0.id) }
                }
        }
    }
}
