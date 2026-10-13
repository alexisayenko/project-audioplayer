import SwiftUI

@MainActor
final class AddFlow: SongFormState {
    enum Phase: Equatable { case idle, loading, ready, saving, saved, failed }

    @Published var url = ""
    @Published var phase = Phase.idle
    @Published var preview: Preview?
    @Published var message: String?
    @Published var errorCode: String?

    func loadPreview(_ api: APIClient) async {
        let clean = cleanPasted(url)
        url = clean
        guard !clean.isEmpty, phase != .loading, phase != .saving else { return }
        phase = .loading; message = nil; errorCode = nil; resetMetadata()
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

    /// Saves on the server, then hands the download to `ServerLink` so it outlives the sheet. True when the sheet may close.
    func save(settings: Settings, library: LibraryStore, server: ServerLink, player: PlayerService, download: Bool) async -> Bool {
        guard let p = preview, phase == .ready || phase == .failed else { return false }
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        phase = .saving; message = nil
        let wikiS = wikiSongValue ?? "", wikiA = wikiArtistValue ?? ""
        let finalTagList = commitPending()
        let meta: [String: Any] = [
            "title": title, "artist": artist, "album": album,
            "remixer": remixerValue.map { $0 as Any } ?? NSNull(),
            "year": yearValue.map { $0 as Any } ?? NSNull(),
            "wikipedia_song": wikiS.isEmpty ? NSNull() : wikiS,
            "wikipedia_artist": wikiA.isEmpty ? NSNull() : wikiA,
        ]
        do {
            try await api.addSong(url: p.source_url ?? url, metadata: meta, tags: finalTagList)
        } catch {
            message = error.localizedDescription; phase = .failed; return false
        }
        let track = Track(id: p.id, title: title, artist: artist, duration: p.duration,
                          thumbnail: p.thumbnail == nil ? nil : "/covers/\(p.id)",
                          album: album.isEmpty ? nil : album, remixer: remixerValue, year: yearValue, tags: finalTagList,
                          bpm: nil, sourceURL: p.source_url,
                          wikipediaSong: wikiS.isEmpty ? nil : wikiS, wikipediaArtist: wikiA.isEmpty ? nil : wikiA)
        if download {
            server.startIngest(track, settings: settings, library: library, player: player, playWhenReady: false)
        } else {
            server.notice = "Saved. Not downloaded to this iPhone"
            server.listWhenSaved(p.id, settings: settings, library: library)
        }
        phase = .saved
        return true
    }
}

/// The Add sheet's one-line link errors: a bold lead and a plain explanation, keyed by the server's error code.
func linkErrorCopy(code: String?, detail: String) -> (lead: String, rest: String) {
    switch code {
    case "unsupported": return ("Unsupported link.", "Electrophone takes YouTube and SoundCloud links only.")
    case "private": return ("Private track.", "The server can't reach it. Make it public or use a secret share link.")
    case "not_found": return ("Track not found.", "The link may be wrong or the track was removed.")
    default: return ("", detail)
    }
}

/// The Add flow as a sheet over Library: link, Fetch, preview, edit, Save. The download continues on the song's Library row.
struct AddSheet: View {
    @StateObject private var flow = AddFlow()
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var path: [String] = []
    @State private var contentHeight: CGFloat = 0

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var knownSong: Track? { flow.phase == .idle || flow.phase == .loading ? libraryMatch(link: flow.url, in: library.songs) : nil }
    private var busy: Bool { flow.phase == .loading || flow.phase == .saving }
    private var hasPreview: Bool { flow.preview != nil && flow.phase != .idle && flow.phase != .loading }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space4) {
                    header
                    if !hasPreview { linkField }
                    if flow.phase == .idle, flow.message != nil, flow.errorCode == "preview_only" { previewOnlyNotice }
                    if let p = flow.preview, hasPreview { previewSections(p) }
                    else if flow.phase == .idle, flow.message != nil { disabledSave }
                }
                .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space6).padding(.bottom, DS.Space.space4)
                .measuredHeight($contentHeight)
            }
            .scrollBounceBehavior(.basedOnSize)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let p = flow.preview, hasPreview { pinnedActions(p) }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(DS.Color.surface.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { _ in
                SearchView { result in
                    flow.url = "https://www.youtube.com/watch?v=\(result.id)"
                    path = []
                    flow.launch { await flow.loadPreview(api) }
                }
            }
            .task { await server.check(settings: settings) }
        }
        .presentationDetents(path.isEmpty && !hasPreview && contentHeight > 0 ? [.height(contentHeight + 12)] : [.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(DS.Radius.radiusTray)
        .presentationBackground(DS.Color.surface)
        .onChange(of: flow.phase) { _, phase in
            if phase == .saved { dismiss() }
        }
        .onDisappear { flow.cancelLookups() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text("Add a song").font(T.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                Spacer(minLength: DS.Space.space2)
                Button("Cancel") { dismiss() }
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
            }
            .padding(.bottom, -DS.Space.space2)
            Text("YouTube or SoundCloud, downloaded to this iPhone").dsCaption()
            if server.reachable != true { ServerStatus(compact: true) }
        }
    }

    private func fetch() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        flow.launch { await flow.loadPreview(api) }
    }

    private var linkField: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            HStack(spacing: DS.Space.space2) {
                TextField("YouTube or SoundCloud link", text: $flow.url)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    .submitLabel(.go).font(T.subhead).frame(minHeight: 44).foregroundStyle(DS.Color.ink)
                    .onSubmit { fetch() }
                    .onChange(of: flow.url) { old, new in
                        if new.count - old.count > 1 { let c = cleanPasted(new); if c != new { flow.url = c } }
                    }
                Button { fetch() } label: {
                    Group { if flow.phase == .loading { ProgressView().tint(scheme.onStrong) } else { Text("Fetch") } }
                        .font(T.subhead.weight(.semibold)).foregroundStyle(scheme.onStrong)
                        .padding(.horizontal, 14).frame(minWidth: 64, minHeight: 36)
                        .background(Capsule().fill(scheme.strongFill))
                }
                .buttonStyle(.plain)
                .disabled(fetchOff)
                .opacity(fetchOff ? 0.5 : 1)
            }
            .padding(.leading, DS.Space.space4).padding(.trailing, DS.Space.space2).frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DS.Color.surfaceSunken))
            .overlay {
                if linkFailed { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DS.Color.power, lineWidth: 1.5) }
            }
            if let known = knownSong {
                HStack(alignment: .center, spacing: DS.Space.space2) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DS.Color.accentInk).accessibilityHidden(true)
                    Text("Already in your library: \(known.title) · \(known.artist)")
                        .font(T.caption).foregroundStyle(DS.Color.ink).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if library.tracks.contains(where: { $0.id == known.id }) {
                        Button("Play") { player.playNow(known); dismiss() }
                            .font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                            .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                    }
                }
                .padding(.top, DS.Space.space2)
                .accessibilityElement(children: .combine)
            }
            if linkFailed, let m = flow.message {
                let copy = linkErrorCopy(code: flow.errorCode, detail: m)
                HStack(alignment: .top, spacing: DS.Space.space2) {
                    Image(systemName: "exclamationmark.circle").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DS.Color.power).padding(.top, 2).accessibilityHidden(true)
                    (copy.lead.isEmpty ? Text(copy.rest) : Text(copy.lead).font(T.caption.weight(.semibold)) + Text(" " + copy.rest))
                        .font(T.caption).foregroundStyle(DS.Color.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.top, DS.Space.space2)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Error: \(copy.lead) \(copy.rest)")
            }
            NavigationLink(value: "search") {
                Label("Search YouTube by title", systemImage: "magnifyingglass")
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
            }
        }
    }

    private var fetchOff: Bool { busy || flow.url.trimmingCharacters(in: .whitespaces).isEmpty || knownSong != nil }

    private var linkFailed: Bool {
        flow.phase == .idle && flow.message != nil && flow.errorCode != "preview_only"
    }

    private var previewOnlyNotice: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(DS.Color.power).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Preview only").font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
                Text("This is a SoundCloud Go+ track. Only its 30-second preview is available, so it can't be saved as a full song.")
                    .font(T.caption).foregroundStyle(DS.Color.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(DS.Space.space3)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceSunken))
        .accessibilityElement(children: .combine)
    }

    private var disabledSave: some View {
        Button { () } label: {
            HStack(spacing: DS.Space.space2) { Image(systemName: "plus"); Text("Add to library") }
        }
        .buttonStyle(LitButtonStyle()).disabled(true)
    }

    private var summary: String {
        [flow.artist, flow.year].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var timing: String {
        [flow.preview?.duration.map(formatTime)].compactMap { $0 }.joined(separator: " · ")
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
                HStack(spacing: DS.Space.space2) {
                    if !timing.isEmpty { Text(timing).font(T.time).foregroundStyle(DS.Color.inkMuted) }
                    Text(sourceLabel(p.source ?? sourceOf(id: p.id))).font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DS.Color.inkMuted).padding(.horizontal, DS.Space.space2).frame(height: 20)
                        .background(Capsule().fill(DS.Color.surfaceSunken))
                }
            }
            Spacer(minLength: DS.Space.space2)
        }
        .accessibilityElement(children: .contain)

        if p.in_library == true {
            FormNote(text: "This song is already in your library.", error: true)
            if let t = library.tracks.first(where: { $0.id == p.id }) {
                Button { player.playNow(t); dismiss() } label: { Label("Play now", systemImage: "play.fill") }
                    .buttonStyle(LitButtonStyle())
            } else {
                Button("Download to iPhone") {
                    Task { _ = await server.download(Track(id: p.id, title: p.title ?? "", artist: p.artist ?? "",
                                                             duration: p.duration, thumbnail: p.thumbnail == nil ? nil : "/covers/\(p.id)",
                                                             album: p.album, remixer: p.remixer, year: p.year, tags: p.tags, sourceURL: p.source_url),
                                                    settings: settings, into: library) }
                }
                .buttonStyle(DSButtonStyle(kind: .outline))
            }
        }

        SongFormView(form: flow, api: api, sources: { [p.source_url ?? flow.url].filter { !$0.isEmpty } }) {
            Text("BPM is detected after saving").font(T.caption).foregroundStyle(DS.Color.inkMuted)
        }

        if let m = flow.message { FormNote(text: m, error: true) }
    }

    private func pinnedActions(_ p: Preview) -> some View {
        let blocked = p.in_library == true || flow.title.trimmingCharacters(in: .whitespaces).isEmpty || flow.phase == .saving
        return VStack(spacing: DS.Space.space1) {
        Button { Task { _ = await flow.save(settings: settings, library: library, server: server, player: player, download: settings.downloadNewAutomatically) } } label: {
            HStack(spacing: DS.Space.space2) {
                if flow.phase == .saving { ProgressView().tint(DS.Color.onAccent) } else { Image(systemName: "plus") }
                Text("Add to library")
            }
        }
        .buttonStyle(LitButtonStyle()).disabled(blocked)
        Button { Task { _ = await flow.save(settings: settings, library: library, server: server, player: player, download: true) } } label: {
            Label("Add and download to iPhone", systemImage: "arrow.down.to.line")
                .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                .frame(maxWidth: .infinity, minHeight: DS.Space.hit)
        }
        .disabled(blocked).opacity(blocked ? 0.5 : 1)
        }
        .padding(DS.Space.space3)
        .background(DS.Color.surface)
        .dsFloat(radius: DS.Radius.radiusTray)
        .padding(.horizontal, DS.Space.space2)
    }
}
