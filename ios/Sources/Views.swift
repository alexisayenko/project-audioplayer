import SwiftUI

struct RootView: View {
    @EnvironmentObject var player: PlayerService

    var body: some View {
        TabView {
            LibraryView().tabItem { Label("Library", systemImage: "music.note.list") }
            SearchView().tabItem { Label("Search", systemImage: "magnifyingglass") }
            SettingsView().tabItem { Label("Settings", systemImage: "gear") }
        }
        .safeAreaInset(edge: .bottom, spacing: 49) {
            if player.current != nil { MiniPlayer() }
        }
    }
}

struct LibraryView: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(library.tracks.enumerated()), id: \.element.id) { i, track in
                    Button { player.play(library.tracks, startAt: i) } label: {
                        TrackRow(title: track.title, artist: track.artist, thumbnail: track.thumbnail)
                    }
                    .tint(.primary)
                }
                .onDelete { library.remove(at: $0) }
            }
            .overlay { if library.tracks.isEmpty { Text("No downloads yet").foregroundStyle(.secondary) } }
            .navigationTitle("Library")
        }
    }
}

struct SearchView: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var settings: Settings
    @State private var query = ""
    @State private var results: [SearchResult] = []
    @State private var downloading: Set<String> = []
    @State private var error: String?

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }

    var body: some View {
        NavigationStack {
            List(results) { result in
                HStack {
                    TrackRow(title: result.title, artist: result.artist, thumbnail: result.thumbnail)
                    Spacer()
                    if library.contains(result.id) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    } else if downloading.contains(result.id) {
                        ProgressView()
                    } else {
                        Button { Task { await download(result) } } label: {
                            Image(systemName: "arrow.down.circle")
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Songs, artists")
            .onSubmit(of: .search) { Task { await search() } }
            .alert("Error", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
        }
    }

    private func search() async {
        do { results = try await api.search(query) } catch { self.error = error.localizedDescription }
    }

    private func download(_ result: SearchResult) async {
        downloading.insert(result.id)
        defer { downloading.remove(result.id) }
        do { library.add(try await api.download(result)) } catch { self.error = error.localizedDescription }
    }
}

struct SettingsView: View {
    @EnvironmentObject var settings: Settings

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("http://host:8000", text: $settings.serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    SecureField("API token", text: $settings.token)
                }
            }
            .navigationTitle("Settings")
        }
    }
}

struct TrackRow: View {
    let title: String
    let artist: String
    let thumbnail: String?

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: thumbnail.flatMap(URL.init(string:))) { image in
                image.resizable().scaledToFill()
            } placeholder: { Color.gray.opacity(0.2) }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading) {
                Text(title).lineLimit(1)
                Text(artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}

struct MiniPlayer: View {
    @EnvironmentObject var player: PlayerService

    var body: some View {
        VStack(spacing: 4) {
            Slider(value: Binding(get: { player.position }, set: { player.seek(to: $0) }),
                   in: 0...max(player.duration, 1))
            HStack {
                VStack(alignment: .leading) {
                    Text(player.current?.title ?? "").lineLimit(1)
                    Text(player.current?.artist ?? "").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { player.previous() } label: { Image(systemName: "backward.fill") }
                Button { player.toggle() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").frame(width: 32)
                }
                Button { player.next() } label: { Image(systemName: "forward.fill") }
            }
            .font(.title3)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}
