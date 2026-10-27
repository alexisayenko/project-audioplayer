import SwiftUI

@main
struct ElectrophoneMacApp: App {
    @StateObject private var library = LibraryStore()
    @StateObject private var player = PlayerService()
    @StateObject private var settings = Settings()
    @StateObject private var server = ServerLink()
    @StateObject private var nav = MacNavigation()

    var body: some Scene {
        WindowGroup {
            MacRootView()
                .environmentObject(library)
                .environmentObject(player)
                .environmentObject(player.clock)
                .environmentObject(settings)
                .environmentObject(server)
                .environmentObject(AuthService.shared)
                .environmentObject(nav)
                .frame(minWidth: 900, minHeight: 600)
                .task { player.artworkServer = { [settings] in ArtworkServer(base: settings.serverURL, token: settings.token) } }
        }
        .commands { MacCommands(player: player, nav: nav) }
    }
}
