import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case library, playback, playlists, statistics, tools, settings

    var title: String {
        switch self {
        case .library: "Library"
        case .playback: "Now playing"
        case .playlists: "Playlists"
        case .statistics: "Statistics"
        case .tools: "Tools"
        case .settings: "Settings"
        }
    }
    var symbol: String {
        switch self {
        case .playback: "waveform"
        case .library: "books.vertical"
        case .playlists: "music.note.list"
        case .statistics: "chart.xyaxis.line"
        case .tools: "wrench.and.screwdriver"
        case .settings: "gearshape"
        }
    }
}

private struct DockHeightKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    /// Height of the floating mini player while it is shown, else 0.
    var dockHeight: CGFloat {
        get { self[DockHeightKey.self] }
        set { self[DockHeightKey.self] = newValue }
    }
}

private struct DockClearance: ViewModifier {
    @Environment(\.dockHeight) private var dock

    func body(content: Content) -> some View { content.contentMargins(.bottom, dock, for: .scrollContent) }
}

extension View {
    /// Lets the last rows of a scroll view rise above the mini player; screens inside a NavigationStack do not receive the root's bottom inset.
    func dockClearance() -> some View { modifier(DockClearance()) }
}

struct RootView: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var anon: AnonDownloader
    @EnvironmentObject var listening: ListeningStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var playlists = PlaylistStore()
    @StateObject private var albums = AlbumStore()
    @StateObject private var albumDownloader = AlbumDownloader()
    @State private var tab = AppTab.library
    @State private var menuOpen = false
    @State private var selectTick = 0
    @State private var expandedDock = false
    @State private var keyboardUp = false
    @State private var dockHeight: CGFloat = 0

    private var showsDock: Bool { tab != .playback && player.current != nil && !keyboardUp }

    var body: some View {
        ZStack {
            page(.library) { LibraryHome() }
            page(.playback) { PlaybackView() }
            page(.playlists) { PlaylistsView() }
            page(.statistics) { statistics }
            page(.tools) { ToolsView(isVisible: tab == .tools) }
            page(.settings) { SettingsView() }
        }
        .environmentObject(playlists)
        .environmentObject(albums)
        .environmentObject(albumDownloader)
        .environment(\.openMenu, { menuOpen = true })
        .environment(\.openSettings, { tab = .settings })
        .environment(\.dockHeight, showsDock ? dockHeight : 0)
        .accessibilityHidden(menuOpen)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if showsDock {
                MiniPlayer(open: { tab = .playback }, onExpand: { expandedDock = true })
                    .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space2)
                    .measuredHeight($dockHeight)
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
        .sensoryFeedback(.selection, trigger: selectTick)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardUp = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardUp = false }
        .sheet(isPresented: $expandedDock) {
            PlaybackView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(DS.Radius.radiusCard)
                .presentationBackground(DS.Color.ground)
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .task {
            PlayQueue.shared.configure(settings: settings)
            anon.resumePending(library: library)
            await server.check(settings: settings)
            await server.syncCatalog(settings: settings, library: library)
        }
        .onChange(of: ServerLink.hasCredentials(settings)) { _, signedIn in
            if !signedIn { albumDownloader.cancelAll() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .playsUploaded)) { _ in
            Task { await listening.load(settings: settings, signedIn: ServerLink.hasCredentials(settings)) }
        }
        .onChange(of: scenePhase) { _, p in
            if p == .active {
                library.refreshPhone()
                anon.resumePending(library: library)
                Task { await server.syncCatalog(settings: settings, library: library) }
            }
        }
    }
}

extension RootView {
    fileprivate var statistics: some View {
        let signedIn = ServerLink.hasCredentials(settings)
        let settings = settings
        return StatisticsView(
            songs: library.songs,
            signedIn: signedIn,
            isVisible: tab == .statistics,
            isActive: scenePhase == .active,
            loaded: !signedIn || server.synced || !library.songs.isEmpty,
            fetchListening: { try await APIClient(baseURL: settings.serverURL, token: settings.token).fetch(Endpoints.statsListening) })
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
    let onExpand: () -> Void
    @ScaledMetric(relativeTo: .title3) private var icon: CGFloat = 22
    @ScaledMetric(relativeTo: .body) private var scaledCover: CGFloat = 44
    @Environment(\.dynamicTypeSize) private var typeSize

    private var compact: Bool { typeSize.isAccessibilitySize }
    private var cover: CGFloat { compact ? DS.Space.hit : scaledCover }
    private var glyph: CGFloat { compact ? DS.Icon.iconPlay : icon }

    var body: some View {
        VStack(spacing: 0) {
            if !compact {
                Button(action: onExpand) {
                    Capsule().fill(DS.Color.inkFaint)
                        .frame(width: 36, height: 4)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: DS.Space.hit)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Expand player")
                .accessibilityHint("Opens Now Playing")
            }

            HStack(spacing: DS.Space.space3) {
                CoverImage(source: player.current?.thumbnail)
                    .frame(width: cover, height: cover)
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(player.current?.title ?? "").font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(compact ? 2 : 1)
                    if !compact {
                        Text(player.current?.artist ?? "").font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Button { player.toggle() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: glyph))
                        .foregroundStyle(DS.Color.ink).frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                Button { player.next() } label: {
                    Image(systemName: "forward.end.fill").font(.system(size: glyph))
                        .foregroundStyle(DS.Color.ink).frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                }
                .accessibilityLabel("Next song")
            }
            .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2 + 2)
            .contentShape(Rectangle())
            .onTapGesture(perform: open)
            MiniProgress().accessibilityHidden(true)
        }
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous))
        .dsFloat(radius: DS.Radius.radiusCard)
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Expand player") { onExpand() }
    }
}

private struct MiniProgress: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var clock: PlaybackClock
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { geo in
            Rectangle().fill(.clear)
                .overlay(alignment: .topLeading) {
                    ZStack(alignment: .leading) {
                        Rectangle().fill(DS.Color.surfaceSunken)
                        Rectangle().fill(scheme.strongFill)
                            .frame(width: geo.size.width * min(1, clock.position / max(clock.duration, 1)))
                    }
                    .frame(height: DS.Stroke.strokeProgress)
                    .padding(.top, DS.Space.space1)
                }
                .contentShape(Rectangle())
                .highPriorityGesture(SpatialTapGesture().onEnded { tap in
                    guard clock.duration > 0, geo.size.width > 0 else { return }
                    let tapped = min(1, max(0, tap.location.x / geo.size.width)) * clock.duration
                    if let target = PlaybackSeek.tapTarget(current: clock.position, duration: clock.duration, tapped: tapped) {
                        player.seek(to: target)
                    }
                })
                .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { drag in
                    guard clock.duration > 0, geo.size.width > 0 else { return }
                    let target = min(1, max(0, drag.location.x / geo.size.width)) * clock.duration
                    player.seek(to: target)
                })
        }
        .frame(height: DS.Space.space6)
    }
}
