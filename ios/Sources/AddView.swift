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

    func save(settings: Settings, library: LibraryStore, server: ServerLink) async {
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
        let wikiS = wikiSong.trimmingCharacters(in: .whitespaces), wikiA = wikiArtist.trimmingCharacters(in: .whitespaces)
        let track = Track(id: p.id, title: title, artist: artist, duration: p.duration,
                          thumbnail: p.thumbnail == nil ? nil : "/covers/\(p.id)",
                          album: album.isEmpty ? nil : album, year: yearValue, tags: finalTags(tags, pending: pendingTag),
                          bpm: Int(bpm.trimmingCharacters(in: .whitespaces)).map(Double.init), sourceURL: p.source_url,
                          wikipediaSong: wikiS.isEmpty ? nil : wikiS, wikipediaArtist: wikiA.isEmpty ? nil : wikiA)
        savedTrack = track
        onPhone = await server.download(track, settings: settings, into: library)
        phase = .saved
    }

    func fetchToPhone(settings: Settings, library: LibraryStore, server: ServerLink) async {
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
    @EnvironmentObject var server: ServerLink
    @StateObject private var flow = AddFlow()
    @State private var path: [String] = []
    let openPlayback: () -> Void

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var pool: [(tag: String, count: Int)] { tagCounts(library.tracks.map { $0.tags ?? [] }) }
    private var busy: Bool { flow.phase == .loading || flow.phase == .saving }
    private var locked: Bool { flow.phase == .saving || flow.phase == .saved }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space4) {
                    ScreenHeader(title: "Add music", subtitle: "From a link to your iPhone.")
                    ServerStatus()
                    linkSection
                    if let p = flow.preview, flow.phase != .idle, flow.phase != .loading { previewSections(p) }
                }
                .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
            }
            .scrollDismissesKeyboard(.interactively)
            .dsGround()
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { _ in
                SearchView { result in
                    flow.url = "https://www.youtube.com/watch?v=\(result.id)"
                    path = []
                    Task { await flow.loadPreview(api) }
                }
            }
            .task { await server.check(settings: settings) }
        }
    }

    private var linkSection: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            SectionLabel("YouTube link")
            HStack(spacing: DS.Space.space2) {
                TextField("Paste a YouTube link", text: $flow.url)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    .submitLabel(.go).font(T.subhead).foregroundStyle(DS.Color.ink)
                    .onSubmit { Task { await flow.loadPreview(api) } }
                    .onChange(of: flow.url) { old, new in
                        if new.count - old.count > 1 { let c = cleanPasted(new); if c != new { flow.url = c } }
                    }
                Button {
                    if let s = UIPasteboard.general.string { flow.url = cleanPasted(s) }
                } label: {
                    Image(systemName: "doc.on.clipboard").foregroundStyle(DS.Color.accentInk)
                        .frame(width: DS.Space.hit, height: DS.Space.hit)
                }
                .accessibilityLabel("Paste")
                Button { Task { await flow.loadPreview(api) } } label: {
                    if flow.phase == .loading { ProgressView().tint(DS.Color.ink) } else { Text("Fetch") }
                }
                .buttonStyle(DSButtonStyle(kind: .primary))
                .disabled(busy || flow.url.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.leading, DS.Space.space4).padding(.trailing, DS.Space.space1).frame(minHeight: 52)
            .dsSlab(radius: 16)
            NavigationLink(value: "search") {
                Label("Search YouTube", systemImage: "magnifyingglass")
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
            }
            if flow.phase == .idle, let m = flow.message { quiet(m, error: true) }
        }
    }

    private func quiet(_ text: String, error: Bool = false) -> some View {
        Label {
            Text(text).font(T.caption).foregroundStyle(error ? DS.Color.ink : DS.Color.inkMuted)
        } icon: {
            Image(systemName: error ? "exclamationmark.circle.fill" : "info.circle").foregroundStyle(error ? DS.Color.power : DS.Color.inkMuted)
        }
    }

    private func card<C: View>(_ label: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            if let label { SectionLabel(label) }
            VStack(alignment: .leading, spacing: DS.Space.space3, content: content)
                .padding(DS.Space.space4).frame(maxWidth: .infinity, alignment: .leading).dsSlab()
        }
    }

    private func labeled(_ label: String, _ text: Binding<String>, keyboard: UIKeyboardType = .default, url: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TextField(label, text: text).keyboardType(keyboard)
                .textInputAutocapitalization(url ? .never : .sentences).autocorrectionDisabled(url).dsField()
        }
    }

    @ViewBuilder
    private func previewSections(_ p: Preview) -> some View {
        card {
            HStack(spacing: DS.Space.space3) {
                CoverImage(source: p.thumbnail).frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.title ?? "Untitled").font(T.title).foregroundStyle(DS.Color.ink).lineLimit(3)
                    if let a = p.artist { Text([a, p.year.map(String.init)].compactMap { $0 }.joined(separator: " · "))
                        .font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
                    if let d = p.duration { Text(formatTime(d)).font(T.time).foregroundStyle(DS.Color.inkMuted) }
                }
            }
            if p.in_library == true {
                quiet("This song is already in your library.", error: true)
                if library.contains(p.id) {
                    Label("On iPhone", systemImage: "checkmark.circle.fill").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.ink)
                } else {
                    Button("Download to iPhone") {
                        Task { _ = await server.download(Track(id: p.id, title: p.title ?? "", artist: p.artist ?? "",
                                                                 duration: p.duration, thumbnail: p.thumbnail == nil ? nil : "/covers/\(p.id)",
                                                                 album: p.album, year: p.year, tags: p.tags, sourceURL: p.source_url),
                                                        settings: settings, into: library) }
                    }
                    .buttonStyle(DSButtonStyle(kind: .outline))
                }
            }
        }

        card("Details") {
            labeled("Title", $flow.title)
            labeled("Artist", $flow.artist)
            labeled("Album", $flow.album)
            labeled("Year", $flow.year, keyboard: .numberPad)
            labeled("BPM (optional, detected after saving)", $flow.bpm, keyboard: .numberPad)
        }
        .disabled(locked)

        card("Wikipedia") {
            labeled("Wikipedia: song", $flow.wikiSong, keyboard: .URL, url: true)
            labeled("Wikipedia: band", $flow.wikiArtist, keyboard: .URL, url: true)
            Button { Task { await flow.lookupWiki(api) } } label: {
                HStack { Text("Fill from Wikipedia links"); if flow.wikiBusy { ProgressView() } }
            }
            .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(flow.wikiBusy)
            if let n = flow.wikiNote { quiet(n) }
        }
        .disabled(locked)

        card("Tags") {
            TagEditor(tags: $flow.tags, suggested: $flow.suggested, pool: pool, input: $flow.pendingTag)
        }
        .disabled(locked)

        actions
    }

    @ViewBuilder
    private var actions: some View {
        switch flow.phase {
        case .saving:
            card {
                HStack {
                    Text("Downloading").font(T.headline).foregroundStyle(DS.Color.ink)
                    Spacer()
                    Text("\(Int(flow.progress * 100))%").font(T.time).foregroundStyle(DS.Color.accentInk)
                }
                ProgressView(value: flow.progress).tint(DS.Color.accent)
                Text("The server is fetching \(flow.title). It then copies to this iPhone.").dsCaption()
            }
        case .saved:
            card {
                Label("Saved to your library.", systemImage: "checkmark.circle.fill").font(T.headline).foregroundStyle(DS.Color.ink)
                if !flow.onPhone {
                    quiet("Saved on the server; not yet on the phone.", error: true)
                    Button("Download to iPhone") {
                        Task { await flow.fetchToPhone(settings: settings, library: library, server: server) }
                    }
                    .buttonStyle(DSButtonStyle(kind: .primary))
                } else if let t = flow.savedTrack {
                    Button { player.playNow(t) } label: { Label("Play now", systemImage: "play.fill") }
                        .buttonStyle(DSButtonStyle(kind: .primary, tall: true))
                    HStack {
                        Button("Playback", action: openPlayback).buttonStyle(DSButtonStyle(kind: .outline))
                        Button("Add another") { flow.reset() }.buttonStyle(DSButtonStyle(kind: .outline))
                    }
                }
            }
        default:
            if let m = flow.message { quiet(m, error: true) }
            Button { Task { await flow.save(settings: settings, library: library, server: server) } } label: {
                Label("Save to iPhone", systemImage: "arrow.down.to.line")
            }
            .buttonStyle(DSButtonStyle(kind: .primary, tall: true))
            .disabled(flow.preview?.in_library == true || flow.title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}

/// The server's status LED, shown on Add and Settings (never on Library).
struct ServerStatus: View {
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var settings: Settings

    var body: some View {
        Button { Task { await server.check(settings: settings) } } label: {
            HStack(spacing: DS.Space.space2) {
                if server.checking { ProgressView().controlSize(.small) }
                else { LED(color: color, glow: server.reachable != nil) }
                Text(text).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.ink)
            }
            .frame(minHeight: DS.Space.hit, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text).accessibilityHint("Checks the server again")
    }

    private var color: Color {
        switch server.reachable { case true: DS.Color.ok; case false: DS.Color.power; default: DS.Color.inkFaint }
    }

    private var text: String {
        switch server.reachable { case true: "Server online"; case false: "Server unavailable"; default: "Server not set up" }
    }
}
