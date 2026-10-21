import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case library, playback, playlists, statistics, settings

    var title: String {
        switch self {
        case .library: "Library"
        case .playback: "Now playing"
        case .playlists: "Playlists"
        case .statistics: "Statistics"
        case .settings: "Settings"
        }
    }
    var symbol: String {
        switch self {
        case .playback: "play"
        case .library: "books.vertical"
        case .playlists: "music.note.list"
        case .statistics: "chart.xyaxis.line"
        case .settings: "gearshape"
        }
    }
}

struct RootView: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var guest: GuestCatalog
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = AppTab.library
    @State private var menuOpen = false
    @State private var selectTick = 0

    var body: some View {
        ZStack {
            page(.library) { LibraryView() }
            page(.playback) { PlaybackView() }
            page(.playlists) { PlaylistsView() }
            page(.statistics) { statistics }
            page(.settings) { SettingsView() }
        }
        .environment(\.openMenu, { menuOpen = true })
        .environment(\.openSettings, { tab = .settings })
        .accessibilityHidden(menuOpen)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if tab != .playback, player.current != nil {
                MiniPlayer { tab = .playback }
                    .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space2)
                    .ignoresSafeArea(.keyboard)
                    .accessibilityHidden(menuOpen)
            }
        }
        .overlay(alignment: .leading) {
            if !menuOpen {
                Color.clear.frame(width: DS.Space.space5).contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 12).onEnded { if $0.translation.width > 40 { menuOpen = true } })
                    .accessibilityHidden(true)
            }
        }
        .overlay {
            SideDrawer(open: menuOpen, selection: $tab, close: { menuOpen = false }) { t in
                selectTick += 1
                tab = t
                menuOpen = false
            }
        }
        .overlay(alignment: .top) { streamNoticeBanner }
        .sensoryFeedback(.selection, trigger: selectTick)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .task {
            installGuestSource()
            await server.check(settings: settings)
            await server.syncCatalog(settings: settings, library: library)
        }
        .onChange(of: scenePhase) { _, p in
            if p == .active {
                Task {
                    await server.syncCatalog(settings: settings, library: library)
                    if !ServerLink.hasCredentials(settings) { await guest.refresh(settings: settings) }
                }
            }
        }
    }
}

extension RootView {
    /// Guest mode: a song with no file on the phone streams from the owner's public library, anonymously.
    fileprivate func installGuestSource() {
        let settings = settings, guest = guest
        player.guestSource = GuestSource(
            streamURL: { guest.streamURL(for: $0, settings: settings) },
            diagnose: { await GuestStream.diagnose(baseURL: settings.serverURL, id: $0.id) })
    }

    fileprivate var statistics: some View {
        let signedIn = ServerLink.hasCredentials(settings)
        let settings = settings
        return StatisticsView(
            songs: signedIn ? library.songs : guest.songs(mergedWith: library),
            signedIn: signedIn,
            loaded: signedIn ? (server.synced || !library.songs.isEmpty) : guest.settled,
            fetchListening: { try await APIClient(baseURL: settings.serverURL, token: settings.token).fetch(Endpoints.statsListening) })
    }

    @ViewBuilder
    fileprivate var streamNoticeBanner: some View {
        if let notice = player.streamNotice {
            HStack(spacing: DS.Space.space3) {
                Text(notice.message).font(T.caption).foregroundStyle(DS.Color.ink).frame(maxWidth: .infinity, alignment: .leading)
                if let link = notice.link {
                    Button("Open link") { openURL(link) }
                        .font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk).frame(minHeight: 32)
                }
            }
            .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
            .dsSlab(radius: DS.Radius.radiusKey)
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2)
            .accessibilityElement(children: .combine)
            .task(id: notice.id) {
                try? await Task.sleep(for: .seconds(notice.link == nil ? 6 : 10))
                if player.streamNotice?.id == notice.id { player.streamNotice = nil }
            }
        }
    }

    /// All screens stay alive so a filter or search survives a menu switch.
    fileprivate func page<V: View>(_ t: AppTab, @ViewBuilder _ content: () -> V) -> some View {
        content()
            .opacity(tab == t ? 1 : 0)
            .allowsHitTesting(tab == t)
            .accessibilityHidden(tab != t)
            .zIndex(tab == t ? 1 : 0)
    }
}

struct MiniPlayer: View {
    @EnvironmentObject var player: PlayerService
    let open: () -> Void
    @ScaledMetric(relativeTo: .title3) private var icon: CGFloat = 22
    @ScaledMetric(relativeTo: .body) private var cover: CGFloat = 44

    var body: some View {
        HStack(spacing: DS.Space.space3) {
            CoverImage(source: player.current?.thumbnail)
                .frame(width: cover, height: cover)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(player.current?.title ?? "").font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(1)
                Text(player.current?.artist ?? "").font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button { player.toggle() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: icon))
                    .foregroundStyle(DS.Color.ink).frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
            }
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            Button { player.next() } label: {
                Image(systemName: "forward.end.fill").font(.system(size: icon))
                    .foregroundStyle(DS.Color.ink).frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
            }
            .accessibilityLabel("Next song")
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2 + 2)
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
        .overlay(alignment: .bottomLeading) {
            MiniProgress().accessibilityHidden(true)
        }
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous))
        .dsFloat(radius: DS.Radius.radiusCard)
        .accessibilityElement(children: .contain)
    }
}

private struct MiniProgress: View {
    @EnvironmentObject var clock: PlaybackClock

    var body: some View {
        GeometryReader { geo in
            Rectangle().fill(DS.Color.accent)
                .frame(width: geo.size.width * min(1, clock.position / max(clock.duration, 1)), height: 3)
                .frame(maxHeight: .infinity, alignment: .bottom)
        }
    }
}
