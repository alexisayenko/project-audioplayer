import SwiftUI
import UniformTypeIdentifiers

/// Add and Edit state on top of the shared `SongFormState`: the link, the preview, saving.
@MainActor
final class MacSongForm: SongFormState {
    enum Phase: Equatable { case idle, loading, ready, saving, failed }

    @Published var url = ""
    @Published var phase = Phase.idle
    @Published var preview: Preview?
    @Published var message: String?
    @Published var errorCode: String?
    @Published var bpm: Int?
    @Published var detecting = false

    static func make(for target: SongFormTarget) -> MacSongForm {
        switch target {
        case .add(let link):
            let f = MacSongForm()
            f.url = link
            return f
        case .edit(let t):
            let f = MacSongForm(song: ServerSong(t))
            f.bpm = t.bpm.map { Int($0.rounded()) }
            f.phase = .ready
            return f
        }
    }

    func loadPreview(_ api: APIClient) async {
        let clean = cleanPasted(url)
        url = clean
        guard !clean.isEmpty, phase != .loading, phase != .saving else { return }
        phase = .loading; message = nil; errorCode = nil; musicbrainzURL = ""; resetMetadata()
        do {
            let p = try await api.preview(url: clean)
            preview = p
            title = p.title ?? ""; artist = p.artist ?? ""; album = p.album ?? ""
            remixer = p.remixer ?? ""
            year = p.year.map(String.init) ?? ""
            wikiSong = p.wikipedia_song ?? ""; wikiArtist = p.wikipedia_artist ?? ""
            let sug = p.tags ?? []
            tags = withDecade(sug, p.year); suggested = withDecade(sug, p.year); resetPending()
            phase = .ready
        } catch {
            preview = nil
            message = error.localizedDescription
            if case APIError.refused(let code, _) = error { errorCode = code }
            phase = .idle
        }
    }

    private func link(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? NSNull() : t
    }

    /// Saves a catalog entry; `download` also has the server fetch the audio. True when the sheet may close.
    func saveNew(settings: Settings, library: LibraryStore, server: ServerLink, player: PlayerService, download: Bool) async -> Bool {
        guard let p = preview, phase == .ready || phase == .failed else { return false }
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        phase = .saving; message = nil
        let finalTagList = commitPending()
        let meta: [String: Any] = [
            "title": title, "artist": artist, "album": album,
            "remixer": link(remixer),
            "year": yearValue.map { $0 as Any } ?? NSNull(),
            "wikipedia_song": link(wikiSong), "wikipedia_artist": link(wikiArtist),
            "musicbrainz_url": musicbrainzValue.map { $0 as Any } ?? NSNull(),
        ]
        do {
            try await api.addSong(url: p.source_url ?? url, metadata: meta, tags: finalTagList, audio: download)
        } catch {
            message = error.localizedDescription; phase = .failed; return false
        }
        await server.syncCatalog(settings: settings, library: library, auto: false)
        if download, let t = library.songs.first(where: { $0.id == p.id }) {
            LibraryUIState.shared.fetch(t, request: false, settings: settings, library: library, server: server, player: player)
        }
        phase = .ready
        return true
    }

    func saveEdit(id: String, settings: Settings, library: LibraryStore) async -> Bool {
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        phase = .saving; message = nil
        var changes = editChanges()
        changes["wikipedia_song"] = link(wikiSong)
        changes["wikipedia_artist"] = link(wikiArtist)
        changes["musicbrainz_url"] = link(musicbrainzURL)
        changes["tags"] = commitPending()
        do {
            let updated = try await api.patch(id, changes: changes)
            library.update(updated.track)
            phase = .ready
            return true
        } catch {
            message = error.localizedDescription; phase = .failed; return false
        }
    }

    func detectBpm(id: String, settings: Settings, library: LibraryStore) async {
        detecting = true; message = nil
        defer { detecting = false }
        do {
            let updated = try await APIClient(baseURL: settings.serverURL, token: settings.token).detectBpm(id)
            bpm = updated.bpm.map { Int($0.rounded()) }
            library.update(updated.track)
        } catch { message = error.localizedDescription }
    }
}

/// The one Add / Edit sheet (560 pt): link and preview for a new song, the same fields for an existing one.
struct MacSongFormSheet: View {
    let target: SongFormTarget
    @StateObject private var form: MacSongForm
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @ObservedObject private var ui = LibraryUIState.shared
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    @State private var importing = false
    @State private var addressOpen = false
    @State private var address = ""
    @State private var coverBusy = false

    init(target: SongFormTarget) {
        self.target = target
        _form = StateObject(wrappedValue: MacSongForm.make(for: target))
    }

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var editing: Track? { if case .edit(let t) = target { return library.songs.first { $0.id == t.id } ?? t } else { return nil } }
    private var busy: Bool { form.phase == .loading || form.phase == .saving || form.metaBusy || form.detecting || coverBusy }
    private var hasPreview: Bool { form.preview != nil && form.phase != .idle && form.phase != .loading }
    private var known: Track? { editing == nil && !hasPreview ? libraryMatch(link: form.url, in: library.songs) : nil }
    private var titleBlank: Bool { form.title.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            header.padding(.horizontal, DS.Space.space5).padding(.top, DS.Space.space5).padding(.bottom, DS.Space.space3)
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space4) {
                    if editing != nil { coverRow }
                    if editing == nil && !hasPreview { linkField }
                    if editing == nil, form.phase == .idle, form.errorCode == "preview_only" { previewOnly }
                    if let p = form.preview, hasPreview, editing == nil { previewHeader(p) }
                    if editing != nil || hasPreview { fields }
                    if let m = form.message, editing != nil || hasPreview { note(m, error: true) }
                }
                .padding(.horizontal, DS.Space.space5).padding(.vertical, DS.Space.space2)
            }
            Divider()
            footer.padding(DS.Space.space4)
        }
        .frame(width: 560).frame(minHeight: 360, maxHeight: 760)
        .background(DS.Color.surface)
        .task {
            if case .add(let link) = target, !link.isEmpty { form.launch { await form.loadPreview(api) } }
        }
        .onDisappear { form.cancelLookups() }
        .confirmationDialog("Delete song?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete from library", role: .destructive) { Task { await delete() } }
        } message: { Text("Removes the song from your library, with its audio and cover.") }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP]) { result in
            if case .success(let url) = result { Task { await upload(url) } }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(editing == nil ? "Add from YouTube or SoundCloud" : "Edit song").font(DS.Font.title).foregroundStyle(DS.Color.ink)
                .accessibilityAddTraits(.isHeader)
            if let t = editing {
                Text(SongName.displayLine(t)).dsCaption().lineLimit(1)
            } else {
                Text("Save the song's details; play it from the original link or from the server.").dsCaption()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func note(_ text: String, error: Bool = false) -> some View {
        Label {
            Text(text).font(T.caption).foregroundStyle(error ? DS.Color.ink : DS.Color.inkMuted)
        } icon: {
            Image(systemName: error ? "exclamationmark.circle.fill" : "info.circle").foregroundStyle(error ? DS.Color.power : DS.Color.inkMuted)
        }
    }

    private func fetch() { form.launch { await form.loadPreview(api) } }

    private var fetchOff: Bool { busy || form.url.trimmingCharacters(in: .whitespaces).isEmpty || known != nil }
    private var linkFailed: Bool { form.phase == .idle && form.message != nil && form.errorCode != "preview_only" }

    private var linkField: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack(spacing: DS.Space.space2) {
                TextField("YouTube or SoundCloud link, or a YouTube video id", text: $form.url)
                    .onSubmit(fetch)
                    .onChange(of: form.url) { old, new in
                        if new.count - old.count > 1 { let c = cleanPasted(new); if c != new { form.url = c } }
                    }
                    .dsField()
                    .overlay { if linkFailed { RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).strokeBorder(DS.Color.power, lineWidth: 1.5) } }
                Button(action: fetch) {
                    if form.phase == .loading { ProgressView().controlSize(.small) } else { Text("Fetch") }
                }
                .buttonStyle(LibLitButtonStyle()).disabled(fetchOff)
            }
            if let known {
                HStack(spacing: DS.Space.space2) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(DS.Color.accentInk)
                    Text("Already in your library: \(SongName.displayLine(known))").font(T.caption).foregroundStyle(DS.Color.ink).lineLimit(2)
                    Spacer(minLength: 0)
                    Button("Show in library") { dismiss(); ui.reveal(known.id) }
                        .buttonStyle(.plain).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                }
            }
            if linkFailed, let m = form.message { note(linkError(form.errorCode, m), error: true) }
            if form.phase == .loading { Text("Reading the link...").dsCaption() }
        }
    }

    private func linkError(_ code: String?, _ detail: String) -> String {
        switch code {
        case "unsupported": "Unsupported link. Electrophone takes YouTube and SoundCloud links only."
        case "private": "Private track. The server can't reach it. Make it public or use a secret share link."
        case "not_found": "Track not found. The link may be wrong or the track was removed."
        default: detail
        }
    }

    private var previewOnly: some View {
        note("Preview only \u{2014} SoundCloud Go+ track, can't be downloaded in full.", error: true)
    }

    private func previewHeader(_ p: Preview) -> some View {
        let summary = [form.artist, form.year].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
        return HStack(spacing: DS.Space.space3) {
            LibCover(source: p.thumbnail, radius: DS.Radius.radiusSm).frame(width: 96, height: 96)
            VStack(alignment: .leading, spacing: 2) {
                Text(form.title.isEmpty ? "Untitled" : form.title).font(DS.Font.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                if !summary.isEmpty { Text(summary).font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1) }
                if !form.album.isEmpty { Text(form.album).dsCaption().lineLimit(1) }
                HStack(spacing: DS.Space.space2) {
                    if let d = p.duration { Text(macTime(d)).font(DS.Font.time).foregroundStyle(DS.Color.inkMuted) }
                    Text(sourceLabel(p.source ?? sourceOf(id: p.id))).font(DS.Font.micro.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
                        .padding(.horizontal, DS.Space.space2).padding(.vertical, 2).background(Capsule().fill(DS.Color.surfaceSunken))
                }
            }
            Spacer(minLength: 0)
            if p.in_library == true { note("Already in your library.", error: true) }
        }
    }

    private var coverRow: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack(spacing: DS.Space.space3) {
                LibCover(source: editing?.thumbnail, radius: DS.Radius.radiusSm).frame(width: 96, height: 96)
                VStack(alignment: .leading, spacing: DS.Space.space2) {
                    Menu("Change cover") {
                        Button("Upload file...") { importing = true }
                        Button("From address...") { addressOpen.toggle() }
                        if editing?.thumbnail != nil { Button("Remove cover", role: .destructive) { Task { await removeCover() } } }
                    }
                    .menuStyle(.borderlessButton).fixedSize().disabled(busy)
                    if coverBusy { ProgressView().controlSize(.small) }
                }
                Spacer(minLength: 0)
            }
            if addressOpen {
                HStack(spacing: DS.Space.space2) {
                    TextField("Image address (http or https)", text: $address).dsField().onSubmit { Task { await fromAddress() } }
                    Button("Use this image") { Task { await fromAddress() } }
                        .buttonStyle(LibOutlineButtonStyle()).disabled(busy || address.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func tokenField(_ kind: TokenKind, _ text: Binding<String>, _ moves: [TokenMove]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(kind.label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TokenField(kind: kind, text: text, moves: moves)
        }
    }

    private func moves(from kind: TokenKind) -> [TokenMove] {
        let texts: [TokenKind: Binding<String>] = [.title: $form.title, .artist: $form.artist, .remixer: $form.remixer]
        return [TokenKind.title, .artist, .remixer].filter { $0 != kind && !(form.remixLocked && $0 == .remixer) }
            .compactMap { k in texts[k].map { TokenMove(kind: k, text: $0) } }
    }

    private func readOnly(_ label: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            Text(text).font(T.body).foregroundStyle(DS.Color.ink)
        }
    }

    private func labeled(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TextField(label, text: text).labelsHidden().dsField()
        }
    }

    private var sources: [String] {
        if let t = editing { return [t.sourceURL].compactMap { $0 }.filter { !$0.isEmpty } }
        return [form.preview?.source_url ?? form.url].filter { !$0.isEmpty }
    }

    private var pool: [(tag: String, count: Int)] { tagCounts(library.songs.map { $0.tags ?? [] }) }

    @ViewBuilder private var fields: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            tokenField(.title, $form.title, moves(from: .title))
            tokenField(.artist, $form.artist, moves(from: .artist))
            if let featured = form.featuredSummary { readOnly("Featured", featured) }
            if form.remixLocked, let version = form.versionSummary {
                readOnly("Version", version)
            } else {
                tokenField(.remixer, $form.remixer, moves(from: .remixer))
            }
            if let h = form.hint { hint(h) }
            HStack(spacing: DS.Space.space3) {
                Button { form.launch { await form.getMetadata(api: api, sources: sources) } } label: {
                    HStack { Text("Get metadata"); if form.metaBusy { ProgressView().controlSize(.small) } }
                }
                .buttonStyle(LibOutlineButtonStyle()).disabled(form.metaBusy)
                ServiceIconRow(busy: form.metaBusy, found: form.services)
                Spacer(minLength: 0)
            }
            if let n = form.metaNote { note(n, error: n == "Couldn't load metadata") }
            HStack(alignment: .top, spacing: DS.Space.space3) {
                labeled("Album", $form.album)
                labeled("First released", $form.year).frame(width: 120)
            }
            bpmRow
            LibNamespaceField(title: "Genres", key: "genre", cap: genreCap, tags: $form.tags, input: $form.pendingGenre)
            LibNamespaceField(title: "Countries", key: "country", cap: countryCap, tags: $form.tags, input: $form.pendingCountry)
            tagsEditor
            HStack(alignment: .top, spacing: DS.Space.space3) {
                LibWikiField(title: "Wikipedia: song", value: $form.wikiSong)
                LibWikiField(title: "Wikipedia: band", value: $form.wikiArtist)
            }
        }
    }

    @ViewBuilder private var bpmRow: some View {
        if let t = editing {
            HStack(spacing: DS.Space.space3) {
                Text(form.bpm.map { "\($0) BPM" } ?? "Not detected yet").font(DS.Font.body)
                    .foregroundStyle(form.bpm == nil ? DS.Color.inkMuted : DS.Color.ink)
                Button { Task { await form.detectBpm(id: t.id, settings: settings, library: library) } } label: {
                    HStack { Text("Re-detect"); if form.detecting { ProgressView().controlSize(.small) } }
                }
                .buttonStyle(LibOutlineButtonStyle()).disabled(busy)
                .help("The tempo may come out half or double the real one")
            }
        } else {
            Text("BPM is detected after saving").dsCaption()
        }
    }

    private var tagsEditor: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            Text("Tags").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            LibTagEditor(tags: $form.tags, suggested: $form.suggested, pool: pool, input: $form.pendingTag,
                         hiddenKeys: ["lang", "genre", "country"])
        }
    }

    private func hint(_ h: (artist: String?, title: String?)) -> some View {
        let text = [h.artist, h.title].compactMap { $0 }.joined(separator: " / ")
        return Button { form.applyHint() } label: {
            Label("Wikipedia says: \(text)", systemImage: "lightbulb").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var footer: some View {
        if let t = editing {
            HStack {
                Button("Delete from library") { confirmDelete = true }.buttonStyle(LibOutlineButtonStyle(danger: true)).disabled(busy)
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).buttonStyle(.plain)
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                Button {
                    Task { if await form.saveEdit(id: t.id, settings: settings, library: library) { ui.toast = "Saved"; dismiss() } }
                } label: {
                    HStack { if form.phase == .saving { ProgressView().controlSize(.small) }; Text("Save") }
                }
                .buttonStyle(LibLitButtonStyle()).keyboardShortcut(.defaultAction).disabled(busy || titleBlank)
            }
        } else {
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).buttonStyle(.plain)
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                Spacer()
                if hasPreview {
                    let blocked = form.preview?.in_library == true || titleBlank || busy
                    Button { Task { await saveNew(download: true) } } label: { Label("Add and download", systemImage: "arrow.down.to.line") }
                        .buttonStyle(LibOutlineButtonStyle()).disabled(blocked)
                    Button { Task { await saveNew(download: false) } } label: {
                        HStack { if form.phase == .saving { ProgressView().controlSize(.small) } else { Image(systemName: "plus") }; Text("Add to library") }
                    }
                    .buttonStyle(LibLitButtonStyle()).keyboardShortcut(.defaultAction).disabled(blocked)
                }
            }
        }
    }

    private func saveNew(download: Bool) async {
        if await form.saveNew(settings: settings, library: library, server: server, player: player, download: download) {
            ui.toast = download ? "Saved to library. Downloading to the server" : "Saved to library"
            dismiss()
        }
    }

    private func delete() async {
        guard let t = editing else { return }
        form.phase = .saving
        do { try await api.delete(t.id) }
        catch APIError.http(404, _) {}
        catch { form.message = "Couldn't delete. Check the server and try again."; form.phase = .failed; return }
        library.delete(t.id)
        dismiss()
    }

    private func applyCover(_ song: ServerSong?, id: String) {
        library.setThumbnail(id, song == nil || song?.cover == nil ? nil : "/covers/\(id)")
        ui.bumpCover(id)
        ui.toast = song?.cover == nil ? "Cover removed" : "Cover updated"
    }

    private func coverCall(_ id: String, _ work: () async throws -> ServerSong?) async {
        coverBusy = true; form.message = nil
        defer { coverBusy = false }
        do { applyCover(try await work(), id: id) }
        catch { form.message = error.localizedDescription }
    }

    private func upload(_ url: URL) async {
        guard let t = editing else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { form.message = "Couldn't read that file."; return }
        guard data.count <= 5 * 1024 * 1024 else { form.message = "That image is over 5 MB."; return }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/jpeg"
        let mac = MacAPI(baseURL: settings.serverURL, token: settings.token)
        await coverCall(t.id) { try await mac.uploadCover(t.id, data: data, contentType: type) }
    }

    private func fromAddress() async {
        guard let t = editing else { return }
        let mac = MacAPI(baseURL: settings.serverURL, token: settings.token)
        let u = address.trimmingCharacters(in: .whitespaces)
        await coverCall(t.id) { try await mac.coverFromURL(t.id, url: u) }
        if form.message == nil { addressOpen = false; address = "" }
    }

    private func removeCover() async {
        guard let t = editing else { return }
        let mac = MacAPI(baseURL: settings.serverURL, token: settings.token)
        await coverCall(t.id) { try await mac.removeCover(t.id); return nil }
    }
}
