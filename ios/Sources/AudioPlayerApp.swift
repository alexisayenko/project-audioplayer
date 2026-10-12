import SwiftUI

@main
struct AudioPlayerApp: App {
    @StateObject private var library = LibraryStore()
    @StateObject private var player = PlayerService()
    @StateObject private var settings = Settings()
    @StateObject private var server = ServerLibrary()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(player)
                .environmentObject(settings)
                .environmentObject(server)
        }
    }
}
