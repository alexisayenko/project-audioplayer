import SwiftUI

/// Edit a song's metadata and tags on the server (the web Edit dialog).
struct SongEditView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLibrary
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
    private var pool: [(tag: String, count: Int)] { tagCounts(server.songs.map { $0.tags ?? [] }) }
    private var busy: Bool { saving || detecting || wikiBusy }

    private func link(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? NSNull() : t
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    TextField("Artist", text: $artist)
                    TextField("Album", text: $album)
                    TextField("Year", text: $year).keyboardType(.numberPad)
                        .onChange(of: year) { _, _ in
                            tags = withDecade(tags, yearValue)
                            suggested = withDecade(suggested, yearValue)
                        }
                    HStack {
                        TextField("BPM", text: $bpm).keyboardType(.numberPad)
                        Button { Task { await detect() } } label: {
                            if detecting { ProgressView() } else { Text("Re-detect") }
                        }
                        .buttonStyle(.borderless).disabled(busy)
                    }
                } header: { Text("Details · ДАННЫЕ").panelLabel() }
                .listRowBackground(Theme.panelRaised)

                Section {
                    TextField("Wikipedia: song", text: $wikiSong)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    TextField("Wikipedia: band", text: $wikiArtist)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button { Task { await lookup() } } label: {
                        HStack { Text("Fill from Wikipedia links"); if wikiBusy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy)
                } header: { Text("Wikipedia").panelLabel() }
                .listRowBackground(Theme.panelRaised)

                Section {
                    TagEditor(tags: $tags, suggested: $suggested, pool: pool, input: $pending)
                } header: { Text("Tags · ТЕГИ").panelLabel() }
                .listRowBackground(Theme.panelRaised)

                if let note {
                    Section {
                        Label(note, systemImage: noteIsError ? "exclamationmark.circle" : "info.circle")
                            .font(.footnote).foregroundStyle(noteIsError ? Theme.red : Theme.labelDim)
                    }
                    .listRowBackground(Theme.panelRaised)
                }

                Section {
                    Button("Delete from server", role: .destructive) { confirmDelete = true }.disabled(busy)
                } footer: {
                    Text("Removes the song, its audio and cover from the server. A copy already on the phone stays.")
                        .foregroundStyle(Theme.labelDim)
                }
                .listRowBackground(Theme.panelRaised)
            }
            .scrollContentBackground(.hidden)
            .panelBackground()
            .tint(Theme.cyan)
            .foregroundStyle(Theme.label)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Edit song")
            .navigationBarTitleDisplayMode(.inline)
            .woodBar(.navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.tint(.white) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView().tint(.white) } else { Text("Save") }
                    }
                    .tint(.white).disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Delete \"\(song.title)\" from the server?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await remove() } }
            }
        }
        .preferredColorScheme(.dark)
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
            server.apply(updated)
            if library.contains(song.id) { library.update(updated.track) }
            dismiss()
        } catch { fail(error) }
    }

    private func detect() async {
        detecting = true; note = nil
        defer { detecting = false }
        do {
            let updated = try await api.detectBpm(song.id)
            bpm = updated.bpm.map { String(Int($0.rounded())) } ?? ""
            server.apply(updated)
            if library.contains(song.id) { library.update(updated.track) }
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
            server.forget(song.id)
            dismiss()
        } catch let e as APIError {
            if case .http(404, _) = e { server.forget(song.id); dismiss() } else { fail(e) }
        } catch { fail(error) }
    }
}
