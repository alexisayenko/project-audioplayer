import SwiftUI

@MainActor
final class AddFlow: ObservableObject {
    enum Phase: Equatable { case idle, loading, ready, saving, saved, failed }

    @Published var url = ""
    @Published var phase = Phase.idle
    @Published var preview: Preview?
    @Published var message: String?
    @Published var progress = 0.0
    @Published var savedTrack: Track?
    @Published var onPhone = true
    @Published var wikiNote: String?
    @Published var wikiBusy = false

    @Published var title = ""
    @Published var artist = ""
    @Published var album = ""
    @Published var year = "" { didSet { applyDecade() } }
    @Published var bpm = ""
    @Published var wikiSong = ""
    @Published var wikiArtist = ""
    @Published var tags: [String] = []
    @Published var suggested: [String] = []
    @Published var pendingTag = ""

    var yearValue: Int? { Int(year.trimmingCharacters(in: .whitespaces)) }

    private func applyDecade() {
        tags = withDecade(tags, yearValue)
        suggested = withDecade(suggested, yearValue)
    }

    func reset() {
        phase = .idle; preview = nil; message = nil; progress = 0; savedTrack = nil; url = ""; wikiNote = nil
    }

    func loadPreview(_ api: APIClient) async {
        let clean = cleanPasted(url)
        url = clean
        guard !clean.isEmpty, phase != .loading, phase != .saving else { return }
        phase = .loading; message = nil; savedTrack = nil; wikiNote = nil
        do {
            let p = try await api.preview(url: clean)
            preview = p
            title = p.title ?? ""; artist = p.artist ?? ""; album = p.album ?? ""
            year = p.year.map(String.init) ?? ""; bpm = ""
            wikiSong = p.wikipedia_song ?? ""; wikiArtist = p.wikipedia_artist ?? ""
            let sug = p.tags ?? []
            tags = withDecade(sug, p.year); suggested = withDecade(sug, p.year); pendingTag = ""
            phase = .ready
        } catch {
            preview = nil
            message = error.localizedDescription
            phase = .idle
        }
    }

    func lookupWiki(_ api: APIClient) async {
        let s = wikiSong.trimmingCharacters(in: .whitespaces), a = wikiArtist.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty || !a.isEmpty else { wikiNote = "Add a Wikipedia link first."; return }
        wikiBusy = true; defer { wikiBusy = false }
        do {
            let found = try await api.lookupWikipedia(song: s.isEmpty ? nil : s, artist: a.isEmpty ? nil : a)
            var appliedYear: Int?
            if let y = found.year, yearValue == nil { year = String(y); appliedYear = y }
            for t in found.tags ?? [] where !suggested.contains(where: { $0.lowercased() == t.lowercased() }) { suggested.append(t) }
            wikiNote = lookupSummary(found, appliedYear)
        } catch { wikiNote = error.localizedDescription }
    }

    func save(settings: Settings, library: LibraryStore, server: ServerLibrary) async {
        guard let p = preview, phase == .ready || phase == .failed else { return }
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        phase = .saving; progress = 0; message = nil
        var meta: [String: Any] = [
            "title": title, "artist": artist, "album": album,
            "year": yearValue.map { $0 as Any } ?? NSNull(),
            "wikipedia_song": wikiSong.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() : wikiSong.trimmingCharacters(in: .whitespaces),
            "wikipedia_artist": wikiArtist.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() : wikiArtist.trimmingCharacters(in: .whitespaces),
        ]
        meta["bpm"] = Int(bpm.trimmingCharacters(in: .whitespaces)).map { $0 as Any } ?? NSNull()
        do {
            try await api.addSong(url: p.source_url ?? url, metadata: meta, tags: finalTags(tags, pending: pendingTag))
        } catch {
            message = error.localizedDescription; phase = .failed; return
        }
        var misses = 0
        while true {
            try? await Task.sleep(for: .seconds(1))
            do {
                let st = try await api.status(p.id)
                misses = 0
                progress = st.progress ?? progress
                if st.status == "error" { message = "Download failed: \(st.error ?? "unknown error")"; phase = .failed; return }
                if st.status == "done" { break }
            } catch {
                misses += 1
                if misses >= 8 { message = error.localizedDescription; phase = .failed; return }
            }
        }
        progress = 1
        await server.refresh(settings: settings)
        var track = server.songs.first { $0.id == p.id }?.track
            ?? Track(id: p.id, title: title, artist: artist, duration: p.duration, thumbnail: p.thumbnail,
                     album: album.isEmpty ? nil : album, year: yearValue, tags: tags, sourceURL: p.source_url)
        if track.thumbnail == nil { track.thumbnail = p.thumbnail }
        savedTrack = track
        onPhone = await server.download(track, settings: settings, into: library)
        phase = .saved
    }

    func fetchToPhone(settings: Settings, library: LibraryStore, server: ServerLibrary) async {
        guard let track = savedTrack else { return }
        onPhone = await server.download(track, settings: settings, into: library)
        if !onPhone { message = "Could not copy to the phone. Try again from Library." }
    }
}

func lookupSummary(_ found: WikiLookup, _ appliedYear: Int?) -> String {
    var parts: [String] = []
    if let y = appliedYear { parts.append("year \(y)") }
    let n = found.tags?.count ?? 0
    if n > 0 { parts.append("\(n) suggested \(n == 1 ? "tag" : "tags")") }
    return parts.isEmpty ? "Nothing found for these links." : "Found: \(parts.joined(separator: ", "))."
}

struct AddView: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLibrary
    @StateObject private var flow = AddFlow()
    @State private var path: [String] = []
    let openPlayback: () -> Void

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var pool: [(tag: String, count: Int)] { tagCounts(server.songs.map { $0.tags ?? [] } + library.tracks.map { $0.tags ?? [] }) }
    private var busy: Bool { flow.phase == .loading || flow.phase == .saving }

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                linkSection
                if let p = flow.preview, flow.phase != .idle, flow.phase != .loading { previewSections(p) }
            }
            .scrollContentBackground(.hidden)
            .panelBackground()
            .tint(Theme.cyan)
            .foregroundStyle(Theme.label)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.inline)
            .woodBar(.navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: "search") { Image(systemName: "magnifyingglass") }
                        .accessibilityLabel("Search YouTube")
                }
            }
            .navigationDestination(for: String.self) { _ in
                SearchView { result in
                    flow.url = "https://www.youtube.com/watch?v=\(result.id)"
                    path = []
                    Task { await flow.loadPreview(api) }
                }
            }
        }
    }

    private var linkSection: some View {
        Section {
            TextField("Paste a YouTube link", text: $flow.url)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                .submitLabel(.go)
                .onSubmit { Task { await flow.loadPreview(api) } }
                .onChange(of: flow.url) { old, new in
                    if new.count - old.count > 1 { let c = cleanPasted(new); if c != new { flow.url = c } }
                }
            HStack(spacing: 10) {
                PianoButton(action: {
                    if let s = UIPasteboard.general.string { flow.url = cleanPasted(s) }
                }) { Label("Paste", systemImage: "doc.on.clipboard") }
                PianoButton(lit: true, action: { Task { await flow.loadPreview(api) } }) {
                    if flow.phase == .loading { ProgressView().tint(.black) } else { Text("Preview") }
                }
                .disabled(busy || flow.url.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .buttonStyle(.borderless)
            if flow.phase == .idle, let m = flow.message { quiet(m, error: true) }
        } header: { Text("YouTube link · ССЫЛКА").panelLabel() }
        .listRowBackground(Theme.panelRaised)
    }

    private func quiet(_ text: String, error: Bool = false) -> some View {
        Label(text, systemImage: error ? "exclamationmark.circle" : "info.circle")
            .font(.footnote).foregroundStyle(error ? Theme.red : Theme.labelDim)
    }

    @ViewBuilder
    private func previewSections(_ p: Preview) -> some View {
        Section {
            HStack(spacing: 12) {
                CoverImage(source: p.thumbnail).frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(Theme.chromeEdge, lineWidth: 1))
                VStack(alignment: .leading) {
                    Text(p.title ?? "Untitled").bold().lineLimit(2)
                    if let d = p.duration { Text(formatTime(d)).font(.caption).foregroundStyle(Theme.labelDim) }
                }
            }
            if p.in_library == true {
                quiet("This song is already in your library.", error: true)
                if !library.contains(p.id), let s = server.songs.first(where: { $0.id == p.id }) {
                    Button("Download to phone") {
                        Task { _ = await server.download(s.track, settings: settings, into: library) }
                    }
                    .buttonStyle(.borderless)
                } else if library.contains(p.id) {
                    Label("On phone", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.green).font(.footnote)
                }
            }
        } header: { Text("Preview · ПРОСМОТР").panelLabel() }
        .listRowBackground(Theme.panelRaised)

        Section {
            TextField("Title", text: $flow.title)
            TextField("Artist", text: $flow.artist)
            TextField("Album", text: $flow.album)
            TextField("Year", text: $flow.year).keyboardType(.numberPad)
            TextField("BPM (optional, detected after saving)", text: $flow.bpm).keyboardType(.numberPad)
        } header: { Text("Details · ДАННЫЕ").panelLabel() }
        .listRowBackground(Theme.panelRaised).disabled(flow.phase == .saving || flow.phase == .saved)

        Section {
            TextField("Wikipedia: song", text: $flow.wikiSong).wikiField()
            TextField("Wikipedia: band", text: $flow.wikiArtist).wikiField()
            Button { Task { await flow.lookupWiki(api) } } label: {
                HStack { Text("Fill from Wikipedia links"); if flow.wikiBusy { Spacer(); ProgressView() } }
            }
            .disabled(flow.wikiBusy)
            if let n = flow.wikiNote { quiet(n) }
        } header: { Text("Wikipedia").panelLabel() }
        .listRowBackground(Theme.panelRaised).disabled(flow.phase == .saving || flow.phase == .saved)

        Section {
            TagEditor(tags: $flow.tags, suggested: $flow.suggested, pool: pool, input: $flow.pendingTag)
        } header: { Text("Tags · ТЕГИ").panelLabel() }
        .listRowBackground(Theme.panelRaised).disabled(flow.phase == .saving || flow.phase == .saved)

        Section {
            switch flow.phase {
            case .saving:
                ProgressView(value: flow.progress).tint(Theme.cyan)
                quiet("Downloading on the server, \(Int(flow.progress * 100))%")
            case .saved:
                Label("Saved to your library.", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.green)
                if !flow.onPhone {
                    quiet("Saved on the server; not yet on the phone.", error: true)
                    Button("Download to phone") {
                        Task { await flow.fetchToPhone(settings: settings, library: library, server: server) }
                    }.buttonStyle(.borderless)
                } else if let t = flow.savedTrack {
                    HStack(spacing: 10) {
                        PianoButton(lit: true, action: { player.playNow(t) }) { Label("Play now", systemImage: "play.fill") }
                        PianoButton(action: openPlayback) { Text("Playback") }
                        PianoButton(action: { flow.reset() }) { Text("Add another") }
                    }
                    .buttonStyle(.borderless)
                }
            default:
                if let m = flow.message { quiet(m, error: true) }
                PianoButton(lit: true, action: {
                    Task { await flow.save(settings: settings, library: library, server: server) }
                }) { Text("Save and download") }
                .disabled(flow.preview?.in_library == true || flow.title.trimmingCharacters(in: .whitespaces).isEmpty)
                .buttonStyle(.borderless)
            }
        }
        .listRowBackground(Theme.panelRaised)
    }
}

private extension View {
    func wikiField() -> some View {
        textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
    }
}
