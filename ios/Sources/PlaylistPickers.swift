import SwiftUI

/// Pick library songs to add to a playlist (PLS-126): search, tick, "Add N".
struct SongPickerSheet: View {
    let excluded: Set<String>
    let add: ([String]) -> Void
    @EnvironmentObject private var library: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var picked: [String] = []

    private var candidates: [Track] {
        let free = library.songs.filter { !excluded.contains($0.id) }
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return free }
        return free.filter { $0.title.localizedCaseInsensitiveContains(q) || $0.libraryArtist.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") { dismiss() }.font(T.subhead).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
                Spacer()
                Text("Add songs").font(T.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Add \(picked.count)") { add(picked); dismiss() }.font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(minHeight: DS.Space.hit).disabled(picked.isEmpty)
            }.padding(.horizontal, DS.Space.space4)
            LibrarySearchField(text: $search, placeholder: "Search your songs").padding(.horizontal, DS.Space.space4)
            ScrollView {
                if candidates.isEmpty {
                    Text(search.isEmpty ? "Every song is already in the playlist." : "No songs found.").font(T.body)
                        .foregroundStyle(DS.Color.inkMuted).padding(DS.Space.space6)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(candidates) { track in
                            pickRow(track)
                            LibraryHairline().padding(.horizontal, DS.Space.space3)
                        }
                    }.clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).librarySlab()
                        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
                }
            }
        }.dsGround().presentationDetents([.large]).presentationBackground(DS.Color.ground)
    }

    private func pickRow(_ track: Track) -> some View {
        let on = picked.contains(track.id)
        return Button {
            if on { picked.removeAll { $0 == track.id } } else { picked.append(track.id) }
        } label: {
            HStack(spacing: DS.Space.space3) {
                CoverImage(source: track.thumbnail).frame(width: DS.Component.coverRow, height: DS.Component.coverRow)
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: DS.Space.space1) {
                    Text(track.title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                    Text(track.librarySubtitle).font(T.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.system(size: DS.Icon.iconNav))
                    .foregroundStyle(on ? DS.Color.accentInk : DS.Color.inkFaint).accessibilityHidden(true)
            }
            .padding(DS.Space.space3).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(LibraryPressStyle()).background(DS.Color.surface)
        .accessibilityLabel(track.title + ", " + track.libraryArtist).accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Pick the playlist for one or more songs, or start a new one with them (PLS-126).
struct PlaylistPickerSheet: View {
    let songIDs: [String]
    let done: (String) -> Void
    @EnvironmentObject private var store: PlaylistStore
    @EnvironmentObject private var settings: Settings
    @Environment(\.dismiss) private var dismiss
    @State private var creating = false
    @State private var newName = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: DS.Space.space3) {
            HStack {
                Text("Add to playlist").font(T.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Cancel") { dismiss() }.font(T.subhead).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
            }.padding(.horizontal, DS.Space.space4)
            if let error { Text(error).font(T.caption).foregroundStyle(DS.Color.powerText).padding(.horizontal, DS.Space.space4) }
            ScrollView {
                VStack(spacing: 0) {
                    Button { newName = ""; creating = true } label: { rowLabel("New playlist…", symbol: "plus", count: nil) }
                        .buttonStyle(LibraryPressStyle())
                    ForEach(store.lists) { list in
                        LibraryHairline().padding(.horizontal, DS.Space.space3)
                        Button { add(to: list) } label: { rowLabel(list.name, symbol: "music.note.list", count: list.count) }
                            .buttonStyle(LibraryPressStyle())
                    }
                }.background(DS.Color.surface).clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).librarySlab()
                    .padding(.horizontal, DS.Space.space4)
            }
        }
        .padding(.top, DS.Space.space3).dsGround().presentationDetents([.medium, .large]).presentationBackground(DS.Color.ground)
        .task { if !store.loaded { await store.refresh(settings) } }
        .alert("New playlist", isPresented: $creating) {
            TextField("Name", text: $newName)
            Button("Create") { create() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func rowLabel(_ title: String, symbol: String, count: Int?) -> some View {
        HStack(spacing: DS.Space.space3) {
            Image(systemName: symbol).font(.system(size: DS.Icon.iconNav)).foregroundStyle(DS.Color.inkMuted).frame(width: DS.Component.coverRow)
            Text(title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
            Spacer(minLength: 0)
            if let count { Text(String(count)).font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
        }.padding(DS.Space.space3).frame(maxWidth: .infinity, minHeight: DS.Space.hit, alignment: .leading).contentShape(Rectangle())
    }

    private func add(to list: PlaylistSummary) {
        Task {
            do {
                let result = try await store.add(songIDs, to: list.id, settings)
                done(PlaylistLogic.addedNote(name: list.name, result: result, asked: songIDs.count))
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }

    private func create() {
        guard let name = PlaylistLogic.cleanName(newName) else { error = "A playlist name needs 1 to \(PlaylistLogic.nameMax) characters"; return }
        Task {
            do {
                _ = try await store.create(name: name, songIDs: songIDs, settings)
                done("Added to \(name)")
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
