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
    @State private var onlyPhone = false
    @State private var showAdd = false
    @StateObject private var addFlow = AddFlow()

    private var counts: [(tag: String, count: Int)] {
        var counts: [String: (tag: String, count: Int)] = [:]
        for t in library.songs { for tag in t.tags ?? [] {
            let k = tag.lowercased()
            counts[k] = (counts[k]?.tag ?? tag, (counts[k]?.count ?? 0) + 1)
        } }
        return Array(counts.values)
    }

    private func filtered(_ selection: Set<String>) -> [Track] {
        var list = library.songs.filter { tagFilterMatches($0, selection: selection) && (!onlyPhone || library.contains($0.id)) }
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            list = list.filter { t in
                ([t.title, t.artist, t.album ?? ""] + (t.tags ?? []).flatMap { [$0, tagLabel($0)] })
                    .contains { $0.lowercased().contains(q) }
            }
        }
        switch sort {
        case .newest:
            let order = Dictionary(uniqueKeysWithValues: list.enumerated().map { ($1.id, $0) })
            list.sort {
                let a = $0.addedAt ?? .distantPast, b = $1.addedAt ?? .distantPast
                return a == b ? order[$0.id, default: 0] < order[$1.id, default: 0] : a > b
            }
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
        server.transfers.values.map(\.track).filter { t in !library.songs.contains { $0.id == t.id } }.sorted { $0.title < $1.title }
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
                            Text("\(library.songs.count) \(library.songs.count == 1 ? "song" : "songs")").dsCaption()
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
                        ToggleChip(title: "Downloaded", count: library.tracks.count, on: onlyPhone) { onlyPhone.toggle() }
                    }
                    list(tracks)
                }
                .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await server.syncCatalog(settings: settings, library: library) }
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
                    if let t = deleting { Task { await delete(t) } }
                    deleting = nil
                }
            } message: { Text("Removes the song from your library, on the server and on this iPhone.") }
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
        if library.songs.isEmpty && arriving.isEmpty {
            if server.forbidden {
                empty(APIError.forbiddenMessage)
            } else if !ServerLink.hasCredentials(settings) {
                empty("Sign in in Settings to load your library.")
            } else if server.syncing || !server.synced && server.reachable != false {
                empty("Loading your library\u{2026}")
            } else if !server.synced {
                empty("Can't reach the server. Pull down to try again.")
            } else {
                empty("No songs yet. Tap + to add one.")
            }
        } else if tracks.isEmpty && arriving.isEmpty {
            empty(onlyPhone && selection.isEmpty && search.isEmpty
                  ? "Nothing is on this iPhone yet. Tap Downloaded to see every song."
                  : "No songs match. Clear the search or the filters.")
        } else {
            LazyVStack(spacing: 0) {
                ForEach(arriving) { t in
                    SongRow(title: t.title, subtitle: subtitle(t), source: t.source, thumbnail: t.thumbnail,
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
        let onPhone = library.contains(track.id)
        let progress = server.transfers[track.id]?.progress
        let hasAudio = onPhone || (track.onServer ?? true)
        let playable = tracks.filter { library.contains($0.id) }
        let start = { player.play(playable, startAt: playable.firstIndex(of: track) ?? 0) }
        let fetch = { Task { if await server.download(track, settings: settings, into: library) { player.playNow(track) } } }
        return SongRow(title: track.title, subtitle: subtitle(track), source: track.source, thumbnail: track.thumbnail,
                       duration: onPhone ? track.duration : nil,
                       downloading: onPhone ? nil : progress,
                       onDownload: !onPhone && progress == nil && hasAudio ? { fetch() } : nil,
                       noAudio: !onPhone && !hasAudio,
                       playing: playing) {
                Menu {
                    Button { editing = ServerSong(track) } label: { Label("Edit", systemImage: "pencil") }
                    if onPhone {
                        Button { player.playNext(track); toast = "Plays next" } label: { Label("Play next", systemImage: "text.insert") }
                        Button { toast = player.enqueue([track]) == 1 ? "Added to queue" : "Already in queue" } label: {
                            Label("Add to queue", systemImage: "text.badge.plus")
                        }
                        if track.localOnly != true {
                            Button { library.removeAudio(track.id); toast = "Removed from this iPhone" } label: {
                                Label("Remove from iPhone", systemImage: "iphone.slash")
                            }
                        }
                    } else if hasAudio, progress == nil {
                        Button { fetch() } label: { Label("Download", systemImage: "arrow.down.circle") }
                    }
                    Button(role: .destructive) { deleting = track } label: { Label("Delete from library", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 18)).foregroundStyle(playing ? DS.Color.accentInk : DS.Color.inkFaint)
                        .frame(width: 24, height: DS.Space.hit)
                        .contentShape(Rectangle().inset(by: -10))
                }
                .accessibilityLabel("More actions for \(track.title)")
            }
        .onTapGesture {
            if onPhone { start() }
            else if !hasAudio { toast = "No audio yet" }
            else if progress == nil { fetch() }
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: onPhone ? "Play" : "Download") {
            if onPhone { start() } else if hasAudio, progress == nil { fetch() }
        }
    }

    private func delete(_ t: Track) async {
        if t.localOnly != true {
            do { try await APIClient(baseURL: settings.serverURL, token: settings.token).delete(t.id) }
            catch APIError.http(404, _) {}
            catch { toast = "Couldn't delete. Check the server and try again."; return }
        }
        library.delete(t.id)
    }
}
