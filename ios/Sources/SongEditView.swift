import SwiftUI

/// The song sheet: facts, editable details, tags and links, and removal from this iPhone.
struct SongEditView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @Environment(\.dismiss) private var dismiss

    let song: ServerSong
    @State private var title: String
    @State private var artist: String
    @State private var album: String
    @State private var remixer: String
    @State private var year: String
    @State private var bpm: String
    @State private var wikiSong: String
    @State private var wikiArtist: String
    @State private var tags: [String]
    @State private var suggested: [String] = []
    @State private var pending = ""
    @State private var pendingGenre = ""
    @State private var pendingCountry = ""
    @State private var note: String?
    @State private var noteIsError = false
    @State private var saving = false
    @State private var detecting = false
    @State private var wikiBusy = false
    @State private var confirmDelete = false
    @State private var contentHeight: CGFloat = 0
    @State private var addingTags = false
    @State private var editingLinks = false

    init(song: ServerSong) {
        self.song = song
        _title = State(initialValue: song.title)
        _artist = State(initialValue: song.artist ?? "")
        _album = State(initialValue: song.album ?? "")
        _remixer = State(initialValue: song.remixer ?? "")
        _year = State(initialValue: song.year.map(String.init) ?? "")
        _bpm = State(initialValue: song.bpm.map { String(Int($0.rounded())) } ?? "")
        _wikiSong = State(initialValue: song.wikipedia_song ?? "")
        _wikiArtist = State(initialValue: song.wikipedia_artist ?? "")
        _tags = State(initialValue: song.tags ?? [])
    }

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var yearValue: Int? { Int(year.trimmingCharacters(in: .whitespaces)) }
    private var pool: [(tag: String, count: Int)] { tagCounts(library.songs.map { $0.tags ?? [] }) }
    private var busy: Bool { saving || detecting || wikiBusy }

    private func link(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? NSNull() : t
    }

    private var track: Track? { library.songs.first { $0.id == song.id } }

    private var facts: String {
        var parts: [String] = []
        if let d = song.duration { parts.append(formatTime(d)) }
        if let b = Int(bpm.trimmingCharacters(in: .whitespaces)) { parts.append("\(b) BPM") }
        if let t = track, let size = try? FileManager.default.attributesOfItem(atPath: t.fileURL.path)[.size] as? Int {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
            parts.append(t.fileURL.pathExtension.uppercased())
        }
        parts.append(sourceLabel(sourceOf(id: song.id)))
        return parts.joined(separator: " · ")
    }

    private var added: String? {
        track?.addedAt.map { "Added " + $0.formatted(.dateTime.day().month(.abbreviated).year()) }
    }

    private struct SourceLink: Identifiable {
        let id: String
        let symbol: String
        let label: String
        let url: URL?
    }

    private func webURL(_ s: String?) -> URL? {
        let t = (s ?? "").trimmingCharacters(in: .whitespaces)
        return t.lowercased().hasPrefix("http") ? URL(string: t) : nil
    }

    /// Always YouTube, SoundCloud, Spotify, Wikipedia; a source without a link stays in the row, dimmed and inert.
    private var links: [SourceLink] {
        let own = sourceOf(id: song.id)
        let wiki = webURL(wikiSong) ?? webURL(wikiArtist)
        let wikiLabel: String
        if webURL(wikiSong) != nil { wikiLabel = "Wikipedia: song" }
        else if webURL(wikiArtist) != nil { wikiLabel = "Wikipedia: artist" }
        else { wikiLabel = "Not on Wikipedia" }
        return [
            SourceLink(id: "yt", symbol: "play.rectangle.fill", label: own == "youtube" && webURL(song.source_url) != nil ? "Open on YouTube" : "Not on YouTube",
                       url: own == "youtube" ? webURL(song.source_url) : nil),
            SourceLink(id: "sc", symbol: "waveform", label: own == "soundcloud" && webURL(song.source_url) != nil ? "Open on SoundCloud" : "Not on SoundCloud",
                       url: own == "soundcloud" ? webURL(song.source_url) : nil),
            SourceLink(id: "sp", symbol: "music.note", label: "Not on Spotify", url: nil),
            SourceLink(id: "wiki", symbol: "book.closed.fill", label: wikiLabel, url: wiki),
        ]
    }

    private func row(_ label: String, _ text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        Group {
            Text(label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            DSTextField(label: label, text: text, keyboard: keyboard)
        }
    }

    private func tokenRow(_ kind: TokenKind, _ text: Binding<String>, _ moves: [TokenMove]) -> some View {
        Group {
            Text(kind.label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TokenField(kind: kind, text: text, moves: moves)
        }
    }

    private var sheetHeader: some View {
        HStack {
            Button("Cancel") { dismiss() }.frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit, alignment: .leading)
            Spacer()
            Text("Song").font(T.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
            Spacer()
            Button { Task { await save() } } label: {
                if saving { ProgressView() } else { Text("Save") }
            }
            .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
            .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit, alignment: .trailing)
        }
        .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
    }

    private var summary: some View {
        HStack(spacing: 14) {
            CoverImage(source: track?.thumbnail ?? song.track.thumbnail).frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                if let r = (track?.remixer ?? song.remixer), !r.isEmpty { Text("Remix: \(r)").font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(2) }
                if !facts.isEmpty { Text(facts).font(T.time).foregroundStyle(DS.Color.inkMuted) }
                if let added { Text(added).dsCaption() }
            }
            Spacer(minLength: 0)
        }
    }

    private var fields: some View {
        Grid(alignment: .leading, horizontalSpacing: DS.Space.space3, verticalSpacing: DS.Space.space2) {
            GridRow { tokenRow(.title, $title, [TokenMove(kind: .artist, text: $artist), TokenMove(kind: .remixer, text: $remixer)]) }
            GridRow { tokenRow(.artist, $artist, [TokenMove(kind: .title, text: $title), TokenMove(kind: .remixer, text: $remixer)]) }
            GridRow { tokenRow(.remixer, $remixer, [TokenMove(kind: .title, text: $title), TokenMove(kind: .artist, text: $artist)]) }
            GridRow { row("Album", $album) }
            GridRow {
                Text("Year").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
                HStack(spacing: 10) {
                    DSTextField(label: "Year", text: $year, keyboard: .numberPad).frame(width: 80)
                        .onChange(of: year) { _, _ in
                            tags = withDecade(tags, yearValue)
                            suggested = withDecade(suggested, yearValue)
                        }
                    Text("BPM").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
                    DSTextField(label: "BPM", text: $bpm, keyboard: .numberPad).frame(width: 72)
                }
            }
        }
    }

    private let hiddenTagKeys: Set<String> = ["lang", "genre", "country"]

    private var tagSection: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            NamespaceField(title: "Genres", key: "genre", cap: genreCap, tags: $tags, input: $pendingGenre)
            NamespaceField(title: "Countries", key: "country", cap: countryCap, tags: $tags, input: $pendingCountry)
            Text("Tags").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TagFlow(tags: tags.filter { !hiddenTagKeys.contains(tagKey($0)) }, removable: true, adding: addingTags, onRemove: { t in tags.removeAll { $0 == t } }) {
                withAnimation { addingTags.toggle() }
            }
            if addingTags { TagEditor(tags: $tags, suggested: $suggested, pool: pool, input: $pending, hiddenKeys: hiddenTagKeys) }
        }
    }

    private var linkRow: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack(spacing: DS.Space.space2) {
                ForEach(links) { l in
                    let glyph = Image(systemName: l.symbol).font(.system(size: 18, weight: .semibold))
                        .frame(width: DS.Space.hit, height: DS.Space.hit)
                        .background(Circle().fill(DS.Color.surfaceSunken))
                    if let url = l.url {
                        Link(destination: url) { glyph.foregroundStyle(DS.Color.accentInk) }.accessibilityLabel(l.label)
                    } else {
                        glyph.foregroundStyle(DS.Color.inkFaint).opacity(0.6)
                            .accessibilityElement().accessibilityLabel(l.label).accessibilityAddTraits(.isStaticText)
                    }
                }
            }
            Button { withAnimation { editingLinks.toggle() } } label: {
                Text(editingLinks ? "Hide link editor" : "Edit links").font(T.caption.weight(.medium)).foregroundStyle(DS.Color.inkMuted)
                    .frame(minHeight: DS.Space.hit, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
    }

    private var linkEditor: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            WikiLinkField(title: "Wikipedia: song", value: $wikiSong)
            WikiLinkField(title: "Wikipedia: band", value: $wikiArtist)
            HStack(spacing: DS.Space.space2) {
                Button { Task { await lookup() } } label: {
                    HStack { Text("Fill from Wikipedia"); if wikiBusy { ProgressView() } }
                }
                .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(busy)
                Button { Task { await detect() } } label: {
                    HStack { Text("Detect BPM"); if detecting { ProgressView() } }
                }
                .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(busy)
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                sheetHeader
                summary
                fields
                tagSection
                linkRow
                if editingLinks { linkEditor }
                if let note {
                    Label {
                        Text(note).font(T.caption).foregroundStyle(noteIsError ? DS.Color.ink : DS.Color.inkMuted)
                    } icon: {
                        Image(systemName: noteIsError ? "exclamationmark.circle.fill" : "info.circle")
                            .foregroundStyle(noteIsError ? DS.Color.power : DS.Color.inkMuted)
                    }
                }
                if library.contains(song.id), track?.localOnly != true {
                    Button("Remove from iPhone") { confirmDelete = true }
                        .buttonStyle(DSButtonStyle(kind: .danger)).disabled(busy)
                }
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space4).padding(.bottom, DS.Space.space4)
            .measuredHeight($contentHeight)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .background(DS.Color.surface.ignoresSafeArea())
        .presentationDetents(contentHeight > 0 ? [.height(contentHeight + 12)] : [.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(DS.Radius.radiusTray)
        .presentationBackground(DS.Color.surface)
        .confirmationDialog("Remove \"\(song.title)\" from this iPhone?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Remove from iPhone", role: .destructive) { library.removeAudio(song.id); dismiss() }
        } message: { Text("The song stays on your server.") }
    }

    private func fail(_ error: Error) { note = error.localizedDescription; noteIsError = true }

    private func save() async {
        saving = true; note = nil
        defer { saving = false }
        commitNamespaced(&tags, key: "genre", cap: genreCap, input: &pendingGenre)
        commitNamespaced(&tags, key: "country", cap: countryCap, input: &pendingCountry)
        let changes: [String: Any] = [
            "title": title, "artist": artist, "album": album,
            "remixer": link(remixer),
            "year": yearValue.map { $0 as Any } ?? NSNull(),
            "bpm": Int(bpm.trimmingCharacters(in: .whitespaces)).map { $0 as Any } ?? NSNull(),
            "wikipedia_song": link(wikiSong), "wikipedia_artist": link(wikiArtist),
            "tags": finalTags(tags, pending: pending),
        ]
        do {
            let updated = try await api.patch(song.id, changes: changes)
            library.update(updated.track)
            dismiss()
        } catch { fail(error) }
    }

    private func detect() async {
        detecting = true; note = nil
        defer { detecting = false }
        do {
            let updated = try await api.detectBpm(song.id)
            bpm = updated.bpm.map { String(Int($0.rounded())) } ?? ""
            library.update(updated.track)
        } catch { fail(error) }
    }

    private func lookup() async {
        let s = wikiSong.trimmingCharacters(in: .whitespaces)
        let a = wikiArtist.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty || !a.isEmpty else { note = "Add a Wikipedia link first."; noteIsError = true; return }
        wikiBusy = true; note = nil
        defer { wikiBusy = false }
        do {
            let found = try await api.lookupWikipedia(song: s.isEmpty ? nil : s, artist: a.isEmpty ? nil : a)
            var applied: Int?
            if let y = found.year, yearValue == nil { year = String(y); applied = y }
            for t in found.tags ?? [] where !suggested.contains(where: { $0.lowercased() == t.lowercased() }) { suggested.append(t) }
            note = lookupSummary(found, applied); noteIsError = false
        } catch { fail(error) }
    }
}
