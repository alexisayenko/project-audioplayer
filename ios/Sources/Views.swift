import SwiftUI

struct RootView: View {
    @EnvironmentObject var player: PlayerService
    @State private var showNowPlaying = false

    var body: some View {
        TabView {
            LibraryView().miniPlayerInset { showNowPlaying = true }
                .tabItem { Label("Library", systemImage: "music.note.list") }
            SearchView().miniPlayerInset { showNowPlaying = true }
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            SettingsView().miniPlayerInset { showNowPlaying = true }
                .tabItem { Label("Settings", systemImage: "gear") }
        }
        .sheet(isPresented: $showNowPlaying) { NowPlayingView() }
    }
}

private struct MiniPlayerInset: ViewModifier {
    @EnvironmentObject var player: PlayerService
    let onTap: () -> Void

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            if player.current != nil {
                MiniPlayer().onTapGesture(perform: onTap).padding(.bottom, 20)
            }
        }
    }
}

extension View {
    func miniPlayerInset(onTap: @escaping () -> Void) -> some View { modifier(MiniPlayerInset(onTap: onTap)) }
}

struct TrackRow: View {
    let title: String
    let subtitle: String
    let thumbnail: String?
    var highlighted = false

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: thumbnail.flatMap(URL.init(string:))) { image in
                image.resizable().scaledToFill()
            } placeholder: { Color.gray.opacity(0.2) }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading) {
                Text(title).lineLimit(1).foregroundStyle(highlighted ? Color.accentColor : .primary)
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}

func formatTime(_ seconds: Double) -> String {
    let s = Int(max(seconds, 0))
    return String(format: "%d:%02d", s / 60, s % 60)
}

func tagLabel(_ tag: String) -> String {
    guard let colon = tag.firstIndex(of: ":") else { return tag }
    let key = String(tag[..<colon]), value = String(tag[tag.index(after: colon)...])
    switch key {
    case "decade": return "the \(value)"
    case "country", "lang":
        let name = key == "country"
            ? Locale.current.localizedString(forRegionCode: value)
            : Locale.current.localizedString(forLanguageCode: value)
        return name ?? value
    default: return value
    }
}

struct MiniPlayer: View {
    @EnvironmentObject var player: PlayerService

    var body: some View {
        VStack(spacing: 4) {
            ProgressView(value: min(player.position, max(player.duration, 1)), total: max(player.duration, 1))
            HStack {
                VStack(alignment: .leading) {
                    Text(player.current?.title ?? "").lineLimit(1)
                    Text(player.current?.artist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Button { player.previous() } label: { Image(systemName: "backward.fill") }
                Button { player.toggle() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").frame(width: 32)
                }
                Button { player.next() } label: { Image(systemName: "forward.fill") }
            }
            .font(.title3)
            .buttonStyle(.borderless)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .contentShape(Rectangle())
    }
}

struct NowPlayingView: View {
    @EnvironmentObject var player: PlayerService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                AsyncImage(url: player.current?.thumbnail.flatMap(URL.init(string:))) { image in
                    image.resizable().scaledToFit()
                } placeholder: { Color.gray.opacity(0.2) }
                .frame(maxHeight: 260)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                VStack(spacing: 2) {
                    Text(player.current?.title ?? "").font(.title3.bold()).lineLimit(2)
                    Text(player.current?.artist ?? "").foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                VStack(spacing: 2) {
                    Slider(value: Binding(get: { player.position }, set: { player.seek(to: $0) }),
                           in: 0...max(player.duration, 1))
                    HStack {
                        Text(formatTime(player.position))
                        Spacer()
                        Text(formatTime(player.duration))
                    }
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                HStack(spacing: 40) {
                    Button { player.previous() } label: { Image(systemName: "backward.fill") }
                    Button { player.toggle() } label: {
                        Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 56))
                    }
                    Button { player.next() } label: { Image(systemName: "forward.fill") }
                }
                .font(.title)
                List {
                    Section("Queue") {
                        ForEach(Array(player.queue.enumerated()), id: \.element.id) { i, track in
                            Button { player.jump(to: i) } label: {
                                TrackRow(title: track.title, subtitle: track.artist, thumbnail: track.thumbnail,
                                         highlighted: i == player.index)
                            }
                        }
                        .onDelete { player.removeFromQueue(at: $0) }
                    }
                }
                .listStyle(.plain)
            }
            .padding(.horizontal)
            .navigationTitle("Now Playing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
