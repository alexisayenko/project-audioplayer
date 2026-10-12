import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case library, playback, settings

    var title: String {
        switch self { case .library: "Library"; case .playback: "Playback"; case .settings: "Settings" }
    }
    var symbol: String {
        switch self {
        case .library: "music.note.list"
        case .playback: "play.fill"
        case .settings: "gearshape"
        }
    }
}

struct RootView: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @State private var tab = AppTab.library

    var body: some View {
        ZStack {
            page(.library) { LibraryView() }
            page(.playback) { PlaybackView() }
            page(.settings) { SettingsView() }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 12) {
                if tab != .playback, player.current != nil { MiniPlayer { tab = .playback } }
                DSTabBar(selection: $tab)
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space2)
            .ignoresSafeArea(.keyboard)
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .task { await server.check(settings: settings) }
    }
}

extension RootView {
    /// All three screens stay alive so a filter or search survives a tab switch.
    fileprivate func page<V: View>(_ t: AppTab, @ViewBuilder _ content: () -> V) -> some View {
        content()
            .opacity(tab == t ? 1 : 0)
            .allowsHitTesting(tab == t)
            .accessibilityHidden(tab != t)
            .zIndex(tab == t ? 1 : 0)
    }
}

/// Floating tab bar: a surface slab with the active item in an accent-tint pill.
struct DSTabBar: View {
    @Binding var selection: AppTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                let active = tab == selection
                Button { selection = tab } label: {
                    VStack(spacing: DS.Space.space1) {
                        Image(systemName: tab.symbol).font(.system(size: 22, weight: active ? .semibold : .regular))
                            .foregroundStyle(active ? DS.Color.accent : DS.Color.inkMuted)
                            .frame(height: 24)
                        Text(tab.title).font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.7)
                            .foregroundStyle(active ? DS.Color.accentInk : DS.Color.inkMuted)
                    }
                    .frame(maxWidth: .infinity, minHeight: DS.Space.hit + DS.Space.space2)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous)
                        .fill(active ? DS.Color.accentTint : Color.clear))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(6)
        .dsFloatingSlab(radius: DS.Radius.radiusTray)
    }
}

struct MiniPlayer: View {
    @EnvironmentObject var player: PlayerService
    let open: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.space3) {
            CoverImage(source: player.current?.thumbnail)
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(player.current?.title ?? "").font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(1)
                Text(player.current?.artist ?? "").font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button { player.toggle() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 22))
                    .foregroundStyle(DS.Color.ink).frame(width: DS.Space.hit, height: DS.Space.hit)
            }
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            Button { player.next() } label: {
                Image(systemName: "forward.end.fill").font(.system(size: 22))
                    .foregroundStyle(DS.Color.ink).frame(width: DS.Space.hit, height: DS.Space.hit)
            }
            .accessibilityLabel("Next song")
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, 10)
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
        .overlay(alignment: .bottomLeading) {
            GeometryReader { geo in
                Rectangle().fill(DS.Color.accent)
                    .frame(width: geo.size.width * min(1, player.position / max(player.duration, 1)), height: 3)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
            .accessibilityHidden(true)
        }
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous))
        .dsFloatingSlab()
        .accessibilityElement(children: .contain)
    }
}
