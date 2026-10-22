import SwiftUI

@main
struct AudioPlayerApp: App {
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
                .environmentObject(anon)
                .environmentObject(libraryQuery)
                .environmentObject(listening)
        }
    }
}
