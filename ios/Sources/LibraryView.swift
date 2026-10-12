import SwiftUI

enum LibrarySort: String, CaseIterable, Identifiable {
    case newest = "Newest first", title = "Title", artist = "Artist", year = "Year"
    var id: String { rawValue }
}

struct LibraryView: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @State private var search = ""
    @State private var sort = LibrarySort.newest
    @State private var tag: String?
    @State private var toast: String?

    private var allTags: [(tag: String, count: Int)] {
        var counts: [String: Int] = [:]
        for t in library.tracks { for tag in t.tags ?? [] { counts[tag, default: 0] += 1 } }
        return counts.map { ($0.key, $0.value) }.sorted { $0.count != $1.count ? $0.count > $1.count : $0.tag < $1.tag }
    }

    private var shown: [Track] {
        var list = library.tracks
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

    var body: some View {
        NavigationStack {
            let tracks = shown
            List {
                if !allTags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(allTags, id: \.tag) { item in
                                Button { tag = tag == item.tag ? nil : item.tag } label: {
                                    Text("\(tagLabel(item.tag)) \(item.count)")
                                        .font(.caption)
                                        .padding(.horizontal, 10).padding(.vertical, 5)
                                        .background(tag == item.tag ? Color.accentColor : Color.gray.opacity(0.2))
                                        .foregroundStyle(tag == item.tag ? Color.white : Color.primary)
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    }
                    .listRowSeparator(.hidden)
                }
                if !library.tracks.isEmpty {
                    HStack {
                        Text("\(tracks.count) of \(library.tracks.count) songs").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        if (tag != nil || !search.isEmpty) && !tracks.isEmpty {
                            Button("Add all \(tracks.count)") {
                                let added = player.enqueue(tracks)
                                toast = "Added \(added) songs (\(tracks.count - added) already in queue)"
                            }
                            .font(.caption).buttonStyle(.borderless)
                        }
                    }
                    .listRowSeparator(.hidden)
                }
                ForEach(tracks) { track in
                    Button {
                        player.play(tracks, startAt: tracks.firstIndex(of: track) ?? 0)
                    } label: {
                        TrackRow(title: track.title, subtitle: subtitle(track), thumbnail: track.thumbnail,
                                 highlighted: player.current?.id == track.id)
                    }
                    .tint(.primary)
                    .swipeActions(edge: .leading) {
                        Button { player.playNext(track); toast = "Plays next" } label: {
                            Label("Play next", systemImage: "text.insert")
                        }.tint(.blue)
                        Button { toast = player.enqueue([track]) == 1 ? "Added" : "Already in queue" } label: {
                            Label("Queue", systemImage: "text.badge.plus")
                        }.tint(.green)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            if let i = library.tracks.firstIndex(of: track) { library.remove(at: IndexSet(integer: i)) }
                        } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            }
            .listStyle(.plain)
            .overlay {
                if library.tracks.isEmpty {
                    Text("No songs yet. Use Search to download one.").foregroundStyle(.secondary)
                } else if tracks.isEmpty {
                    Text("No songs match. Clear the search or the tag filter.").foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding()
                }
            }
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast).font(.footnote).padding(8).background(.thinMaterial).clipShape(Capsule())
                        .task(id: toast) { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                }
            }
            .navigationTitle("Library")
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
