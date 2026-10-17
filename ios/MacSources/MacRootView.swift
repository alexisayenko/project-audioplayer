import SwiftUI

struct MacRootView: View {
    @EnvironmentObject var nav: MacNavigation
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var auth: AuthService
    @EnvironmentObject var player: PlayerService
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationSplitView {
            MacSidebar()
                .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
        } detail: {
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .safeAreaInset(edge: .bottom, spacing: 0) { MacTransportBar() }
                .background(DS.Color.ground)
        }
        .sheet(isPresented: $nav.showSignIn) { MacSignInSheet() }
        .onAppear { MacKeys.install(player) }
        .task { await server.check(settings: settings); await server.syncCatalog(settings: settings, library: library, auto: false) }
        .onChange(of: scenePhase) { _, p in
            if p == .active { Task { await server.syncCatalog(settings: settings, library: library, auto: false) } }
        }
        .onChange(of: auth.session?.email) { _, _ in
            server.clearForbidden()
            Task { await server.check(settings: settings); await server.syncCatalog(settings: settings, library: library, auto: false) }
        }
    }

    @ViewBuilder private var detail: some View {
        switch nav.page ?? .library {
        case .library: LibraryPage()
        case .playback: PlaybackPage()
        case .settings: SettingsPage()
        }
    }
}
