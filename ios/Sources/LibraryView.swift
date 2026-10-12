import SwiftUI

enum LibrarySort: String, CaseIterable, Identifiable {
    case newest = "Newest first", title = "Title", artist = "Artist", year = "Year"
    var id: String { rawValue }
}

struct LibraryView: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLibrary
    @State private var onServer = false
    @State private var search = ""
    @State private var sort = LibrarySort.newest
    @State private var tag: String?
    @State private var toast: String?
    @State private var editing: ServerSong?

    private var source: [Track] {
        onServer ? server.songs.map(\.track) : library.tracks
    }

    private var allTags: [(tag: String, count: Int)] {
        var counts: [String: Int] = [:]
        for t in source { for tag in t.tags ?? [] { counts[tag, default: 0] += 1 } }
        return counts.map { ($0.key, $0.value) }.sorted { $0.count != $1.count ? $0.count > $1.count : $0.tag < $1.tag }
    }

    private var shown: [Track] {
        var list = source
        if let tag { list = list.filter { ($0.tags ?? []).contains(tag) } }
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            list = list.filter { t in
                ([t.title, t.artist, t.album ?? ""] + (t.tags ?? []).flatMap { [$0, tagLabel($0)] })
                    .contains { $0.lowercased().contains(q) }
            }
        }
        switch sort {
        case .newest: break
        case .title: list.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .artist:
            list.sort {
                let c = $0.artist.localizedCaseInsensitiveCompare($1.artist)
                return c == .orderedSame ? $0.title < $1.title : c == .orderedAscending
            }
        case .year: list.sort { ($0.year ?? -1) > ($1.year ?? -1) }
        }
        return list
    }

    private func subtitle(_ t: Track) -> String {
        [t.artist, t.album, t.year.map(String.init)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private func stateIcon(_ track: Track) -> some View {
        Group {
            if library.contains(track.id) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green)
                    .accessibilityLabel("On phone")
            } else if server.downloading.contains(track.id) {
                ProgressView().tint(.white)
            } else {
                Button { Task { await fetch(track) } } label: {
                    Image(systemName: server.failed.contains(track.id) ? "exclamationmark.arrow.circlepath" : "arrow.down.circle")
                        .foregroundStyle(server.failed.contains(track.id) ? Color.red : Theme.cyan)
                }
                .buttonStyle(.borderless).accessibilityLabel("Download")
            }
        }
    }

    private func serverBar(_ tracks: [Track]) -> some View {
        let missing = tracks.filter { !library.contains($0.id) }
        return HStack {
            LED(on: server.reachable != nil, color: server.reachable == true ? Theme.green : Theme.red)
            Text(server.reachable == false ? "Server unreachable" : server.reachable == nil ? "Server not checked" : server.refreshing ? "Refreshing" : "Server online")
                .panelLabel()
            Spacer()
            if let b = server.batch {
                Text("\(b.done)/\(b.total)").font(.caption.monospacedDigit()).foregroundStyle(Theme.cyan)
                ProgressView().tint(.white)
            } else if !missing.isEmpty {
                PianoButton(lit: true, action: { Task { await server.downloadAll(missing, settings: settings, into: library) } }) {
                    Text("Download all \(missing.count)").font(.caption.smallCaps().weight(.semibold))
                }
            }
        }
        .listRowBackground(Color.clear).listRowSeparator(.hidden)
    }

    private func serverSong(for track: Track) -> ServerSong {
        server.songs.first { $0.id == track.id } ?? ServerSong(track)
    }

    private func fetch(_ track: Track) async {
        if !(await server.download(track, settings: settings, into: library)) { toast = "Download failed" }
    }

    private func open(_ track: Track, in tracks: [Track]) async {
        if onServer && !library.contains(track.id) {
            guard await server.download(track, settings: settings, into: library) else { toast = "Download failed"; return }
        }
        let playable = onServer ? tracks.filter { library.contains($0.id) } : tracks
        player.play(playable, startAt: playable.firstIndex(of: track) ?? 0)
    }

    var body: some View {
        NavigationStack {
            let tracks = shown
            List {
                Picker("Source", selection: $onServer) {
                    Text("On phone · ТЕЛЕФОН").tag(false)
                    Text("Server · СЕРВЕР").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
                if onServer { serverBar(tracks) }
                if !allTags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(allTags, id: \.tag) { item in
                                PianoButton(lit: tag == item.tag, action: { tag = tag == item.tag ? nil : item.tag }) {
                                    Text("\(tagLabel(item.tag)) \(item.count)").font(.caption.smallCaps().weight(.semibold))
                                }
                            }
                        }
                    }
                    .listRowSeparator(.hidden).listRowBackground(Color.clear)
                }
                if !source.isEmpty {
                    HStack {
                        Text("\(tracks.count) of \(source.count) songs").panelLabel()
                        Spacer()
                        if (tag != nil || !search.isEmpty) && !tracks.isEmpty {
                            Button("Add all \(tracks.count)") {
                                let added = player.enqueue(tracks)
                                toast = "Added \(added) songs (\(tracks.count - added) already in queue)"
                            }
                            .font(.caption).buttonStyle(.borderless).tint(Theme.cyan)
                        }
                    }
                    .listRowSeparator(.hidden).listRowBackground(Color.clear)
                }
                ForEach(tracks) { track in
                    Button { Task { await open(track, in: tracks) } } label: {
                        HStack {
                            TrackRow(title: track.title, subtitle: subtitle(track), thumbnail: track.thumbnail,
                                     highlighted: player.current?.id == track.id)
                            if onServer { Spacer(minLength: 0); stateIcon(track) }
                        }
                    }
                    .tint(.primary)
                    .panelRow()
                    .contextMenu {
                        Button { editing = serverSong(for: track) } label: { Label("Edit", systemImage: "pencil") }
                        if library.contains(track.id) {
                            Button { player.playNext(track); toast = "Plays next" } label: { Label("Play next", systemImage: "text.insert") }
                            Button { toast = player.enqueue([track]) == 1 ? "Added" : "Already in queue" } label: {
                                Label("Add to playlist", systemImage: "text.badge.plus")
                            }
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if onServer && !library.contains(track.id) {
                            Button { Task { await fetch(track) } } label: {
                                Label("Download", systemImage: "arrow.down.circle")
                            }.tint(Theme.cyan)
                        }
                        if library.contains(track.id) {
                        Button { player.playNext(track); toast = "Plays next" } label: {
                            Label("Play next", systemImage: "text.insert")
                        }.tint(.blue)
                        Button { toast = player.enqueue([track]) == 1 ? "Added" : "Already in queue" } label: {
                            Label("Queue", systemImage: "text.badge.plus")
                        }.tint(.green)
                        }
                    }
                    .swipeActions(edge: .trailing) {
                        Button { editing = serverSong(for: track) } label: { Label("Edit", systemImage: "pencil") }.tint(.orange)
                        if library.contains(track.id) {
                        Button(role: .destructive) {
                            if let i = library.tracks.firstIndex(of: track) { library.remove(at: IndexSet(integer: i)) }
                        } label: { Label("Delete", systemImage: "trash") }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .panelBackground()
            .overlay {
                if source.isEmpty && onServer {
                    Text(server.reachable == false ? "Server unreachable. No songs cached yet." : "No songs on the server.")
                        .foregroundStyle(Theme.labelDim).multilineTextAlignment(.center).padding()
                } else if source.isEmpty {
                    Text("No songs yet. Use Add to import one.").foregroundStyle(Theme.labelDim)
                } else if tracks.isEmpty {
                    Text("No songs match. Clear the search or the tag filter.").foregroundStyle(Theme.labelDim)
                        .multilineTextAlignment(.center).padding()
                }
            }
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast).font(.footnote).padding(8).foregroundStyle(Theme.label).background(Theme.panelRaised).clipShape(Capsule())
                        .overlay(Capsule().stroke(Theme.chromeEdge, lineWidth: 1))
                        .task(id: toast) { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                }
            }
            .sheet(item: $editing) { SongEditView(song: $0) }
            .refreshable { await server.refresh(settings: settings) }
            .task { await server.refresh(settings: settings) }
            .navigationTitle("Library")
            .navigationBarTitleDisplayMode(.inline)
            .woodBar(.navigationBar)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Title, artist, tag")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Sort", selection: $sort) {
                            ForEach(LibrarySort.allCases) { Text($0.rawValue).tag($0) }
                        }
                    } label: { Image(systemName: "arrow.up.arrow.down") }
                }
            }
        }
    }
}
