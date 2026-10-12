import SwiftUI

@MainActor
final class AddFlow: ObservableObject {
    enum Phase: Equatable { case idle, loading, ready, saving, saved, failed }

    @Published var url = ""
    @Published var phase = Phase.idle
    @Published var preview: Preview?
    @Published var message: String?
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
        phase = .idle; preview = nil; message = nil; url = ""; wikiNote = nil
        title = ""; artist = ""; album = ""; year = ""; bpm = ""; wikiSong = ""; wikiArtist = ""
        tags = []; suggested = []; pendingTag = ""
    }

    func loadPreview(_ api: APIClient) async {
        let clean = cleanPasted(url)
        url = clean
        guard !clean.isEmpty, phase != .loading, phase != .saving else { return }
        phase = .loading; message = nil; wikiNote = nil
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

    /// Saves on the server, then hands the download to `ServerLink` so it outlives the sheet. True when the sheet may close.
    func save(settings: Settings, library: LibraryStore, server: ServerLink, player: PlayerService, playWhenReady: Bool) async -> Bool {
        guard let p = preview, phase == .ready || phase == .failed else { return false }
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        phase = .saving; message = nil
        let wikiS = wikiSong.trimmingCharacters(in: .whitespaces), wikiA = wikiArtist.trimmingCharacters(in: .whitespaces)
        let bpmValue = Int(bpm.trimmingCharacters(in: .whitespaces))
        let finalTagList = finalTags(tags, pending: pendingTag)
        let meta: [String: Any] = [
            "title": title, "artist": artist, "album": album,
            "year": yearValue.map { $0 as Any } ?? NSNull(),
            "wikipedia_song": wikiS.isEmpty ? NSNull() : wikiS,
            "wikipedia_artist": wikiA.isEmpty ? NSNull() : wikiA,
            "bpm": bpmValue.map { $0 as Any } ?? NSNull(),
        ]
        do {
            try await api.addSong(url: p.source_url ?? url, metadata: meta, tags: finalTagList)
        } catch {
            message = error.localizedDescription; phase = .failed; return false
        }
        let track = Track(id: p.id, title: title, artist: artist, duration: p.duration,
                          thumbnail: p.thumbnail == nil ? nil : "/covers/\(p.id)",
                          album: album.isEmpty ? nil : album, year: yearValue, tags: finalTagList,
                          bpm: bpmValue.map(Double.init), sourceURL: p.source_url,
                          wikipediaSong: wikiS.isEmpty ? nil : wikiS, wikipediaArtist: wikiA.isEmpty ? nil : wikiA)
        server.startIngest(track, settings: settings, library: library, player: player, playWhenReady: playWhenReady)
        phase = .saved
        return true
    }
}

func lookupSummary(_ found: WikiLookup, _ appliedYear: Int?) -> String {
    var parts: [String] = []
    if let y = appliedYear { parts.append("year \(y)") }
    let n = found.tags?.count ?? 0
    if n > 0 { parts.append("\(n) suggested \(n == 1 ? "tag" : "tags")") }
    return parts.isEmpty ? "Nothing found for these links." : "Found: \(parts.joined(separator: ", "))."
}

/// The Add flow as a sheet over Library: link, Fetch, preview, edit, Save. The download continues on the song's Library row.
struct AddSheet: View {
    @ObservedObject var flow: AddFlow
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var path: [String] = []
    @State private var contentHeight: CGFloat = 0
    @State private var editing = false
    @State private var addingTags = false

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var pool: [(tag: String, count: Int)] { tagCounts(library.tracks.map { $0.tags ?? [] }) }
    private var busy: Bool { flow.phase == .loading || flow.phase == .saving }
    private var hasPreview: Bool { flow.preview != nil && flow.phase != .idle && flow.phase != .loading }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space4) {
                    header
                    linkField
                    if flow.phase == .idle, let m = flow.message { note(m, error: true) }
                    if let p = flow.preview, hasPreview { previewSections(p) }
                }
                .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space6).padding(.bottom, DS.Space.space4)
                .measuredHeight($contentHeight)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .background(DS.Color.surface.ignoresSafeArea())
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
        .presentationDetents(path.isEmpty && contentHeight > 0 ? [.height(contentHeight + 12)] : [.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(DS.Radius.radiusTray)
        .presentationBackground(DS.Color.surface)
        .onChange(of: flow.phase) { _, phase in
            if phase == .saved { dismiss(); Task { flow.reset(); editing = false; addingTags = false } }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Add from YouTube or SoundCloud").font(T.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                Text("Downloads to this iPhone through your server").dsCaption()
                if server.reachable != true { ServerStatus(compact: true) }
            }
            Spacer(minLength: DS.Space.space2)
            Button("Cancel") { dismiss() }
                .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
        }
    }

    private var linkField: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            HStack(spacing: DS.Space.space2) {
                TextField("Paste a YouTube or SoundCloud link", text: $flow.url)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    .submitLabel(.go).font(T.subhead).frame(minHeight: 44).foregroundStyle(DS.Color.ink)
                    .onSubmit { Task { await flow.loadPreview(api) } }
                    .onChange(of: flow.url) { old, new in
                        if new.count - old.count > 1 { let c = cleanPasted(new); if c != new { flow.url = c } }
                    }
                Button { Task { await flow.loadPreview(api) } } label: {
                    Group { if flow.phase == .loading { ProgressView().tint(scheme.onStrong) } else { Text("Fetch") } }
                        .font(T.subhead.weight(.semibold)).foregroundStyle(scheme.onStrong)
                        .padding(.horizontal, 14).frame(minWidth: 64, minHeight: 36)
                        .background(Capsule().fill(scheme.strongFill))
                }
                .buttonStyle(.plain)
                .disabled(busy || flow.url.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(busy || flow.url.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
            }
            .padding(.leading, DS.Space.space4).padding(.trailing, DS.Space.space2).frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DS.Color.surfaceSunken))
            NavigationLink(value: "search") {
                Label("Search YouTube by title", systemImage: "magnifyingglass")
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
            }
        }
    }

    private func note(_ text: String, error: Bool = false) -> some View {
        Label {
            Text(text).font(T.caption).foregroundStyle(error ? DS.Color.ink : DS.Color.inkMuted)
        } icon: {
            Image(systemName: error ? "exclamationmark.circle.fill" : "info.circle").foregroundStyle(error ? DS.Color.power : DS.Color.inkMuted)
        }
    }

    private func labeled(_ label: String, _ text: Binding<String>, keyboard: UIKeyboardType = .default, url: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TextField(label, text: text).keyboardType(keyboard)
                .textInputAutocapitalization(url ? .never : .sentences).autocorrectionDisabled(url).dsField()
        }
    }

    private var summary: String {
        [flow.artist, flow.year].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var timing: String {
        [flow.preview.map { sourceLabel($0.source ?? sourceOf(id: $0.id)) }, flow.preview?.duration.map(formatTime),
         Int(flow.bpm).map { "\($0) BPM" }].compactMap { $0 }.joined(separator: " · ")
    }

    @ViewBuilder
    private func previewSections(_ p: Preview) -> some View {
        HStack(spacing: 14) {
            CoverImage(source: p.thumbnail).frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(flow.title.isEmpty ? "Untitled" : flow.title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                if !summary.isEmpty { Text(summary).font(T.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1) }
                if !timing.isEmpty { Text(timing).font(T.time).foregroundStyle(DS.Color.inkMuted) }
            }
            Spacer(minLength: DS.Space.space2)
            Button { withAnimation { editing.toggle() } } label: {
                Image(systemName: "pencil").font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DS.Color.accentInk)
                    .frame(width: 40, height: 40)
                    .overlay(Circle().stroke(editing ? DS.Color.accentInk : DS.Color.line, lineWidth: 1.5))
                    .contentShape(Rectangle().inset(by: -2))
            }
            .accessibilityLabel("Edit details").accessibilityAddTraits(editing ? .isSelected : [])
        }
        .accessibilityElement(children: .contain)

        if p.in_library == true {
            note("This song is already in your library.", error: true)
            if let t = library.tracks.first(where: { $0.id == p.id }) {
                Button { player.playNow(t); dismiss() } label: { Label("Play now", systemImage: "play.fill") }
                    .buttonStyle(LitButtonStyle())
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

        if editing {
            VStack(alignment: .leading, spacing: DS.Space.space3) {
                labeled("Title", $flow.title)
                labeled("Artist", $flow.artist)
                labeled("Album", $flow.album)
                labeled("Year", $flow.year, keyboard: .numberPad)
                labeled("BPM (optional, detected after saving)", $flow.bpm, keyboard: .numberPad)
                labeled("Wikipedia: song", $flow.wikiSong, keyboard: .URL, url: true)
                labeled("Wikipedia: band", $flow.wikiArtist, keyboard: .URL, url: true)
                Button { Task { await flow.lookupWiki(api) } } label: {
                    HStack { Text("Fill from Wikipedia links"); if flow.wikiBusy { ProgressView() } }
                }
                .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(flow.wikiBusy)
                if let n = flow.wikiNote { note(n) }
            }
        }

        TagFlow(tags: flow.tags, adding: addingTags, onRemove: { t in flow.tags.removeAll { $0 == t } }) {
            withAnimation { addingTags.toggle() }
        }
        if addingTags {
            TagEditor(tags: $flow.tags, suggested: $flow.suggested, pool: pool, input: $flow.pendingTag)
        }

        if let m = flow.message { note(m, error: true) }
        let blocked = p.in_library == true || flow.title.trimmingCharacters(in: .whitespaces).isEmpty || flow.phase == .saving
        Button { Task { _ = await flow.save(settings: settings, library: library, server: server, player: player, playWhenReady: false) } } label: {
            HStack(spacing: DS.Space.space2) {
                if flow.phase == .saving { ProgressView().tint(DS.Color.onAccent) } else { Image(systemName: "arrow.down.to.line") }
                Text("Save to iPhone")
            }
        }
        .buttonStyle(LitButtonStyle()).disabled(blocked).opacity(blocked ? 0.5 : 1)
        Button { Task { _ = await flow.save(settings: settings, library: library, server: server, player: player, playWhenReady: true) } } label: {
            Text("Save and play when ready").font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                .frame(maxWidth: .infinity, minHeight: DS.Space.hit)
        }
        .disabled(blocked).opacity(blocked ? 0.5 : 1)
    }
}
