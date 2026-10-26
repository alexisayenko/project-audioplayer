import SwiftUI

/// One playlist as a song list (PLS-122 to PLS-125): play, shuffle, queue, add and remove songs, reorder, rename, delete.
struct PlaylistDetailView: View {
    let id: String
    @EnvironmentObject private var store: PlaylistStore
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var server: ServerLink
    @EnvironmentObject private var settings: Settings
    @Environment(\.dismiss) private var dismiss
    @State private var isEditing = false
    @State private var renaming = false
    @State private var renameText = ""
    @State private var confirmDelete = false
    @State private var pickingSongs = false
    @State private var downloading = false
    @State private var toast: String?

    private var detail: PlaylistDetail? { store.details[id] }
    private var shown: [Track] {
        let byID = Dictionary(library.songs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return (detail?.songs ?? []).compactMap { byID[$0] }
    }
    private var missing: [Track] { shown.filter { !library.contains($0.id) && $0.onServer != false } }

    var body: some View {
        SongListScreen(title: detail?.name ?? "Playlist", lines: lines, coverSource: shown.first?.thumbnail,
                       entries: shown.map(SongListEntry.song), actions: actions, isEditing: isEditing, onDone: { isEditing = false },
                       emptyText: "This playlist is empty. Add songs from your library.",
                       extra: { extra }, menu: { menuItems })
            .listToast($toast)
            .task { await store.loadDetail(id, settings) }
            .onChange(of: detail == nil) { _, gone in if gone && store.loaded { dismiss() } }
            .alert("Rename playlist", isPresented: $renaming) {
                TextField("Name", text: $renameText)
                Button("Rename") { rename() }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete \"\(detail?.name ?? "")\"?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete playlist", role: .destructive) { delete() }
            } message: { Text("The songs stay in your library.") }
            .sheet(isPresented: $pickingSongs) {
                SongPickerSheet(excluded: Set(detail?.songs ?? [])) { ids in add(ids) }
            }
    }

    private var lines: [String] {
        [PlaylistLogic.totalText(shown), detail?.description ?? ""].filter { !$0.isEmpty }
    }

    private var actions: SongListActions {
        SongListActions(move: { from, to in move(from, to) }, remove: { remove($0) }, addToPlaylist: nil)
    }

    @ViewBuilder private var extra: some View {
        if !missing.isEmpty {
            Button { downloadMissing() } label: {
                Label(downloading ? "Downloading…" : "Download \(missing.count) missing \(missing.count == 1 ? "song" : "songs")", systemImage: "arrow.down.circle")
            }.buttonStyle(DSButtonStyle(kind: .outline)).disabled(downloading || server.reachable == false)
        }
    }

    @ViewBuilder private var menuItems: some View {
        Button { pickingSongs = true } label: { Label("Add songs", systemImage: "plus") }
        Button { isEditing.toggle() } label: {
            Label(isEditing ? "Done editing" : "Edit order and songs", systemImage: isEditing ? "checkmark" : "arrow.up.arrow.down")
        }.disabled(shown.isEmpty)
        Button { renameText = detail?.name ?? ""; renaming = true } label: { Label("Rename", systemImage: "pencil") }
        Button(role: .destructive) { confirmDelete = true } label: { Label("Delete playlist", systemImage: "trash") }
    }

    private func move(_ from: IndexSet, _ to: Int) {
        guard let detail else { return }
        let rearranged = PlaylistLogic.moved(shown.map(\.id), from: from, to: to)
        let full = PlaylistLogic.merged(full: detail.songs, shown: rearranged)
        Task {
            do { try await store.reorder(id, to: full, settings) } catch { toast = error.localizedDescription }
        }
    }

    private func remove(_ track: Track) {
        Task {
            do { try await store.remove(track.id, from: id, settings); toast = "Removed from the playlist" } catch { toast = error.localizedDescription }
        }
    }

    private func add(_ ids: [String]) {
        guard !ids.isEmpty, let name = detail?.name else { return }
        Task {
            do {
                let result = try await store.add(ids, to: id, settings)
                toast = PlaylistLogic.addedNote(name: name, result: result, asked: ids.count)
            } catch { toast = error.localizedDescription }
        }
    }

    private func rename() {
        guard let name = PlaylistLogic.cleanName(renameText) else { toast = "A playlist name needs 1 to \(PlaylistLogic.nameMax) characters"; return }
        Task {
            do { try await store.rename(id, to: name, settings) } catch { toast = error.localizedDescription }
        }
    }

    private func delete() {
        Task {
            do {
                try await store.delete(id, settings)
                dismiss()
            } catch { toast = error.localizedDescription }
        }
    }

    private func downloadMissing() {
        let wanted = missing
        downloading = true
        Task {
            var done = 0
            for track in wanted {
                if await server.download(track, settings: settings, into: library, quiet: true) { done += 1 }
            }
            downloading = false
            toast = "Downloaded \(done) of \(wanted.count)"
        }
    }
}
