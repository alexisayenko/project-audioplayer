import SwiftUI

/// The song sheet: facts, editable details, tags and links, and removal from this iPhone.
struct SongEditView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var coverSize: CGFloat = 88

    let song: ServerSong
    @StateObject private var form: SongFormState
    @State private var bpm: Int?
    @State private var note: String?
    @State private var noteIsError = false
    @State private var saving = false
    @State private var detecting = false
    @State private var confirmDelete = false
    @State private var contentHeight: CGFloat = 0

    init(song: ServerSong) {
        self.song = song
        _form = StateObject(wrappedValue: SongFormState(song: song))
        _bpm = State(initialValue: song.bpm.map { Int($0.rounded()) })
    }

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var busy: Bool { saving || detecting || form.metaBusy }

    private func link(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? NSNull() : t
    }

    private var track: Track? { library.songs.first { $0.id == song.id } }

    private var facts: String {
        var parts: [String] = []
        if let d = song.duration { parts.append(formatTime(d)) }
        if let b = bpm { parts.append("\(b) BPM") }
        if let t = track, let size = try? FileManager.default.attributesOfItem(atPath: t.fileURL.path)[.size] as? Int {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
            parts.append(t.fileURL.pathExtension.uppercased())
        }
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

    /// Always YouTube, SoundCloud, Spotify, Wikipedia, MusicBrainz, Discogs; a source without a link stays in the row, dimmed and inert.
    private var links: [SourceLink] {
        let own = sourceOf(id: song.id)
        let wiki = webURL(form.wikiSong) ?? webURL(form.wikiArtist)
        let wikiLabel: String
        if webURL(form.wikiSong) != nil { wikiLabel = "Wikipedia: song" }
        else if webURL(form.wikiArtist) != nil { wikiLabel = "Wikipedia: artist" }
        else { wikiLabel = "Not on Wikipedia" }
        let mb = form.services[.musicbrainz] ?? nil
        return [
            SourceLink(id: "yt", symbol: "play.rectangle.fill", label: own == "youtube" && webURL(song.source_url) != nil ? "Open on YouTube" : "Not on YouTube",
                       url: own == "youtube" ? webURL(song.source_url) : nil),
            SourceLink(id: "sc", symbol: "waveform", label: own == "soundcloud" && webURL(song.source_url) != nil ? "Open on SoundCloud" : "Not on SoundCloud",
                       url: own == "soundcloud" ? webURL(song.source_url) : nil),
            SourceLink(id: "sp", symbol: "music.note", label: "Not on Spotify", url: nil),
            SourceLink(id: "wiki", symbol: "book.closed.fill", label: wikiLabel, url: wiki),
            SourceLink(id: "mb", symbol: "music.note.list", label: mb == nil ? "Not on MusicBrainz" : "Open on MusicBrainz", url: mb),
            SourceLink(id: "dc", symbol: "opticaldisc.fill", label: "Not on Discogs", url: nil),
        ]
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
            .disabled(busy || form.title.trimmingCharacters(in: .whitespaces).isEmpty)
            .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit, alignment: .trailing)
        }
        .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
    }

    private var summary: some View {
        HStack(spacing: 14) {
            CoverImage(source: track?.thumbnail ?? song.track.thumbnail).frame(width: coverSize, height: coverSize)
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

    private var linkRow: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack(spacing: DS.Space.space2) {
                ForEach(links) { l in
                    let glyph = Image(systemName: l.symbol).font(.headline)
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
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                sheetHeader
                summary
                linkRow
                SongFormView(form: form, api: api, sources: { [song.source_url].compactMap { $0 }.filter { !$0.isEmpty } }) {
                    HStack(spacing: DS.Space.space3) {
                        Text(bpm.map { "\($0) BPM" } ?? "Not detected yet").font(T.body)
                            .foregroundStyle(bpm == nil ? DS.Color.inkMuted : DS.Color.ink)
                        Button { Task { await detect() } } label: {
                            HStack { Text("Detect BPM"); if detecting { ProgressView() } }
                        }
                        .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(busy)
                    }
                }
                if let note { FormNote(text: note, error: noteIsError) }
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
        .onDisappear { form.cancelLookups() }
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
        let finalTagList = form.commitPending()
        var changes = form.editChanges()
        changes["wikipedia_song"] = link(form.wikiSong)
        changes["wikipedia_artist"] = link(form.wikiArtist)
        changes["musicbrainz_url"] = link(form.musicbrainzURL)
        changes["tags"] = finalTagList
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
            bpm = updated.bpm.map { Int($0.rounded()) }
            library.update(updated.track)
        } catch { fail(error) }
    }
}
