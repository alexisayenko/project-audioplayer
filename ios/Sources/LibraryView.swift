import SwiftUI

enum LibrarySort: String, CaseIterable, Identifiable {
    case newest = "Recently added", title = "Title", artist = "Artist", year = "Year"
    var id: String { rawValue }
}

struct LibraryView: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var search = ""
    @State private var sort = LibrarySort.newest
    @State private var selection: Set<String> = []
    @State private var sheet: FilterCategory?
    @State private var toast: String?
    @State private var editing: ServerSong?
    @State private var deleting: Track?
    @State private var bytes: Int64 = 0
    @State private var showAdd = false
    @StateObject private var addFlow = AddFlow()

    private var counts: [(tag: String, count: Int)] {
        var counts: [String: (tag: String, count: Int)] = [:]
        for t in library.tracks { for tag in t.tags ?? [] {
            let k = tag.lowercased()
            counts[k] = (counts[k]?.tag ?? tag, (counts[k]?.count ?? 0) + 1)
        } }
        return Array(counts.values)
    }

    private func filtered(_ selection: Set<String>) -> [Track] {
        var list = library.tracks.filter { tagFilterMatches($0, selection: selection) }
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

    private var arriving: [Track] {
        server.transfers.values.map(\.track).filter { !library.contains($0.id) }.sorted { $0.title < $1.title }
    }

    private func subtitle(_ t: Track) -> String { t.artist }

    var body: some View {
        let tracks = filtered(selection)
        let counts = counts
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(title: "Library") {
                        HStack(spacing: DS.Space.space3) {
                            Text("\(library.tracks.count) \(library.tracks.count == 1 ? "song" : "songs")").dsCaption()
                            Button { showAdd = true } label: {
                                Image(systemName: "plus").font(.system(size: 22, weight: .semibold))
                            }
                            .buttonStyle(LitCircleButtonStyle())
                            .accessibilityLabel("Add a song")
                        }
                    }
                    searchField
                    chips(counts)
                    HStack {
                        Menu {
                            Picker("Sort", selection: $sort) { ForEach(LibrarySort.allCases) { Text($0.rawValue).tag($0) } }
                        } label: {
                            HStack(spacing: 6) {
                                Text(sort.rawValue); Image(systemName: "chevron.down").font(T.caption.weight(.semibold))
                            }
                            .font(T.headline).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
                        }
                        .accessibilityLabel("Sort: \(sort.rawValue)")
                        Spacer()
                        if bytes > 0 {
                            Text("\(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)) on iPhone").dsCaption()
                        }
                    }
                    list(tracks)
                }
                .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
            }
            .scrollDismissesKeyboard(.interactively)
            .dsGround()
            .toolbar(.hidden, for: .navigationBar)
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast).font(T.caption).foregroundStyle(DS.Color.ink)
                        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
                        .dsSlab(radius: DS.Radius.radiusPill)
                        .task(id: toast) { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                }
            }
            .sheet(item: $editing) { SongEditView(song: $0) }
            .sheet(isPresented: $showAdd) { AddSheet(flow: addFlow) }
            .onChange(of: server.notice) { _, n in
                if let n { toast = n; server.notice = nil }
            }
            .sheet(item: $sheet) { category in
                FilterSheet(category: category, values: category.values(counts), selection: $selection,
                            resultCount: filtered(selection).count)
            }
            .confirmationDialog("Delete \"\(deleting?.title ?? "")\" from the library?", isPresented: Binding(
                get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete from library", role: .destructive) {
                    if let t = deleting { library.remove(t.id) }
                    deleting = nil
                }
            } message: { Text("Removes the audio from this iPhone.") }
            .task(id: library.tracks.count) { bytes = await Self.diskSize(library.tracks) }
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(DS.Color.inkMuted).accessibilityHidden(true)
            TextField("Search songs or artists", text: $search)
                .font(T.body).foregroundStyle(DS.Color.ink).submitLabel(.search)
                .autocorrectionDisabled()
            if !search.isEmpty {
                Button { search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(DS.Color.inkMuted) }
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, DS.Space.space4).frame(minHeight: 48)
        .dsSlab(radius: 16)
    }

    private func chips(_ counts: [(tag: String, count: Int)]) -> some View {
        let cols = typeSize.isAccessibilitySize ? 2 : 4
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: DS.Space.space2), count: cols), spacing: DS.Space.space2) {
            ForEach(FilterCategory.allCases) { c in
                let values = c.values(counts)
                CategoryChip(title: c.rawValue, count: values.count,
                             selected: values.filter { selection.contains($0.tag.lowercased()) }.count) { sheet = c }
            }
        }
    }

    @ViewBuilder
    private func list(_ tracks: [Track]) -> some View {
        if library.tracks.isEmpty && arriving.isEmpty {
            empty("No songs yet. Tap + to bring one to this iPhone.")
        } else if tracks.isEmpty && arriving.isEmpty {
            empty("No songs match. Clear the search or the filters.")
        } else {
            LazyVStack(spacing: 0) {
                ForEach(arriving) { t in
                    SongRow(title: t.title, subtitle: subtitle(t), thumbnail: t.thumbnail,
                            downloading: server.transfers[t.id]?.progress ?? 0)
                    divider
                }
                ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                    row(track, in: tracks)
                    if i < tracks.count - 1, player.current?.id != track.id, player.current?.id != tracks[i + 1].id { divider }
                }
            }
            .dsSlab()
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous))
        }
    }

    private var divider: some View {
        Rectangle().fill(DS.Color.line).frame(height: 1).padding(.horizontal, DS.Space.space3)
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(T.body).foregroundStyle(DS.Color.inkMuted).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity).padding(DS.Space.space6)
    }

    private func row(_ track: Track, in tracks: [Track]) -> some View {
        let playing = player.current?.id == track.id
        return SongRow(title: track.title, subtitle: subtitle(track), thumbnail: track.thumbnail, duration: track.duration,
                    playing: playing) {
                Menu {
                    Button { editing = ServerSong(track) } label: { Label("Edit", systemImage: "pencil") }
                    Button { player.playNext(track); toast = "Plays next" } label: { Label("Play next", systemImage: "text.insert") }
                    Button { toast = player.enqueue([track]) == 1 ? "Added to queue" : "Already in queue" } label: {
                        Label("Add to queue", systemImage: "text.badge.plus")
                    }
                    Button(role: .destructive) { deleting = track } label: { Label("Delete from library", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 18)).foregroundStyle(playing ? DS.Color.accentInk : DS.Color.inkMuted)
                        .frame(width: DS.Space.hit, height: DS.Space.hit)
                }
                .accessibilityLabel("More actions for \(track.title)")
            }
        .onTapGesture { player.play(tracks, startAt: tracks.firstIndex(of: track) ?? 0) }
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Play") { player.play(tracks, startAt: tracks.firstIndex(of: track) ?? 0) }
    }

    private static func diskSize(_ tracks: [Track]) async -> Int64 {
        await Task.detached(priority: .utility) {
            tracks.reduce(Int64(0)) { sum, t in
                sum + Int64((try? FileManager.default.attributesOfItem(atPath: t.fileURL.path)[.size] as? Int) ?? 0)
            }
        }.value
    }
}
