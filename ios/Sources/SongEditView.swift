import SwiftUI

/// Edit a song's metadata and tags on the server (the web Edit dialog).
struct SongEditView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @Environment(\.dismiss) private var dismiss

    let song: ServerSong
    @State private var title: String
    @State private var artist: String
    @State private var album: String
    @State private var year: String
    @State private var bpm: String
    @State private var wikiSong: String
    @State private var wikiArtist: String
    @State private var tags: [String]
    @State private var suggested: [String] = []
    @State private var pending = ""
    @State private var note: String?
    @State private var noteIsError = false
    @State private var saving = false
    @State private var detecting = false
    @State private var wikiBusy = false
    @State private var confirmDelete = false

    init(song: ServerSong) {
        self.song = song
        _title = State(initialValue: song.title)
        _artist = State(initialValue: song.artist ?? "")
        _album = State(initialValue: song.album ?? "")
        _year = State(initialValue: song.year.map(String.init) ?? "")
        _bpm = State(initialValue: song.bpm.map { String(Int($0.rounded())) } ?? "")
        _wikiSong = State(initialValue: song.wikipedia_song ?? "")
        _wikiArtist = State(initialValue: song.wikipedia_artist ?? "")
        _tags = State(initialValue: song.tags ?? [])
    }

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }
    private var yearValue: Int? { Int(year.trimmingCharacters(in: .whitespaces)) }
    private var pool: [(tag: String, count: Int)] { tagCounts(library.tracks.map { $0.tags ?? [] }) }
    private var busy: Bool { saving || detecting || wikiBusy }

    private func link(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? NSNull() : t
    }

    private func card<C: View>(_ label: String, footer: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            SectionLabel(label)
            VStack(alignment: .leading, spacing: DS.Space.space3, content: content)
                .padding(DS.Space.space4).frame(maxWidth: .infinity, alignment: .leading).dsSlab()
            if let footer { Text(footer).dsCaption().padding(.horizontal, DS.Space.space1) }
        }
    }

    private func field(_ label: String, _ text: Binding<String>, keyboard: UIKeyboardType = .default, url: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).dsCaption()
            TextField(label, text: text).keyboardType(keyboard)
                .textInputAutocapitalization(url ? .never : .sentences).autocorrectionDisabled(url).dsField()
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space4) {
                    card("Details") {
                        field("Title", $title)
                        field("Artist", $artist)
                        field("Album", $album)
                        field("Year", $year, keyboard: .numberPad)
                            .onChange(of: year) { _, _ in
                                tags = withDecade(tags, yearValue)
                                suggested = withDecade(suggested, yearValue)
                            }
                        HStack(alignment: .bottom) {
                            field("BPM", $bpm, keyboard: .numberPad)
                            Button { Task { await detect() } } label: {
                                if detecting { ProgressView() } else { Text("Re-detect") }
                            }
                            .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(busy)
                        }
                    }
                    card("Wikipedia") {
                        field("Wikipedia: song", $wikiSong, keyboard: .URL, url: true)
                        field("Wikipedia: band", $wikiArtist, keyboard: .URL, url: true)
                        Button { Task { await lookup() } } label: {
                            HStack { Text("Fill from Wikipedia links"); if wikiBusy { ProgressView() } }
                        }
                        .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(busy)
                    }
                    card("Tags") { TagEditor(tags: $tags, suggested: $suggested, pool: pool, input: $pending) }
                    if let note {
                        Label {
                            Text(note).font(T.caption).foregroundStyle(noteIsError ? DS.Color.ink : DS.Color.inkMuted)
                        } icon: {
                            Image(systemName: noteIsError ? "exclamationmark.circle.fill" : "info.circle")
                                .foregroundStyle(noteIsError ? DS.Color.power : DS.Color.inkMuted)
                        }
                    }
                    VStack(alignment: .leading, spacing: DS.Space.space2) {
                        Button("Delete from library") { confirmDelete = true }
                            .buttonStyle(DSButtonStyle(kind: .danger)).disabled(busy)
                        Text("Removes the song, its audio and cover from the server and from this iPhone.").dsCaption()
                    }
                }
                .padding(DS.Space.space4)
            }
            .scrollDismissesKeyboard(.interactively)
            .dsGround()
            .navigationTitle("Edit song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(DS.Color.accentInk) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text("Save").fontWeight(.semibold) }
                    }
                    .foregroundStyle(DS.Color.accentInk).disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Delete \"\(song.title)\" from the library?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete from library", role: .destructive) { Task { await remove() } }
            }
        }
    }

    private func fail(_ error: Error) { note = error.localizedDescription; noteIsError = true }

    private func save() async {
        saving = true; note = nil
        defer { saving = false }
        let changes: [String: Any] = [
            "title": title, "artist": artist, "album": album,
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
        let s = wikiSong.trimmingCharacters(in: .whitespaces), a = wikiArtist.trimmingCharacters(in: .whitespaces)
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

    private func remove() async {
        saving = true
        defer { saving = false }
        do {
            try await api.delete(song.id)
            library.remove(song.id)
            dismiss()
        } catch let e as APIError {
            if case .http(404, _) = e { library.remove(song.id); dismiss() } else { fail(e) }
        } catch { fail(error) }
    }
}
