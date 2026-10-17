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
    @State private var queueTick = 0
    @State private var deleteTick = 0
    @ScaledMetric(relativeTo: .title2) private var plusSize: CGFloat = 22
    @ScaledMetric(relativeTo: .body) private var moreSize: CGFloat = 18
    @ScaledMetric(relativeTo: .body) private var moreWidth: CGFloat = 24

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
                let a = $0.addedAt ?? .distantPast
                let b = $1.addedAt ?? .distantPast
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
        server.transfers.values.map(\.track).filter { t in !library.contains(t.id) && !library.songs.contains { $0.id == t.id } }.sorted { $0.title < $1.title }
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
                                Image(systemName: "plus").font(.system(size: plusSize, weight: .semibold))
                            }
                            .buttonStyle(LitCircleButtonStyle())
                            .accessibilityLabel("Add a song")
                        }
                    }
                    searchField
                    chips(counts)
                    if typeSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: DS.Space.space2) { sortMenu; downloadedChip }
                    } else {
                        HStack { sortMenu; Spacer(); downloadedChip }
                    }
                    if server.reachable == false && !library.songs.isEmpty { offlineBanner }
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
            .sensoryFeedback(.success, trigger: queueTick)
            .sensoryFeedback(.warning, trigger: deleteTick)
            .sheet(item: $editing) { SongEditView(song: $0) }
            .sheet(isPresented: $showAdd) { AddSheet() }
            .onChange(of: library.phoneIDs) { _, _ in server.reconcile(library) }
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
                    if let t = deleting { deleteTick += 1; Task { await delete(t) } }
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

    private var sortMenu: some View {
        Menu {
            Picker("Sort", selection: $sort) { ForEach(LibrarySort.allCases) { Text($0.rawValue).tag($0) } }
        } label: {
            HStack(spacing: 6) {
                Text(sort.rawValue).lineLimit(1).minimumScaleFactor(0.7)
                Image(systemName: "chevron.down").font(T.caption.weight(.semibold))
            }
            .font(T.headline).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
        }
        .accessibilityLabel("Sort: \(sort.rawValue)")
    }

    private var downloadedChip: some View {
        ToggleChip(title: "Downloaded", count: library.tracks.count, on: onlyPhone) { onlyPhone.toggle() }
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
                unavailable("Access denied", "lock.slash", APIError.forbiddenMessage)
            } else if !ServerLink.hasCredentials(settings) {
                unavailable("Sign in to load your library", "person.crop.circle", "Open the Settings tab to sign in.")
            } else if server.syncing || !server.synced && server.reachable != false {
                unavailable("Loading your library\u{2026}", "arrow.triangle.2.circlepath", nil)
            } else if !server.synced {
                unavailable("Can't reach the server", "wifi.slash", "Check the connection and try again.") {
                    Button("Retry") { Task { await server.syncCatalog(settings: settings, library: library) } }
                        .buttonStyle(.borderedProminent).tint(DS.Color.accentStrong)
                }
            } else {
                unavailable("No songs yet", "music.note.list", "Add a song to start your library.") {
                    Button("Add song") { showAdd = true }.buttonStyle(.borderedProminent).tint(DS.Color.accentStrong)
                }
            }
        } else if tracks.isEmpty && arriving.isEmpty {
            if onlyPhone && selection.isEmpty && search.isEmpty {
                unavailable("Nothing on this iPhone yet", "iphone", "Show every song instead.") {
                    Button("Show all songs") { onlyPhone = false }.buttonStyle(.bordered)
                }
            } else {
                unavailable("No songs match", "magnifyingglass", "Clear the search or the filters.") {
                    Button("Clear filters") { search = ""; selection = [] }.buttonStyle(.bordered)
                }
            }
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

    private func unavailable<A: View>(_ title: String, _ icon: String, _ detail: String?, @ViewBuilder actions: () -> A = { EmptyView() }) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: icon).font(T.headline).foregroundStyle(DS.Color.ink)
        } description: {
            if let detail { Text(detail).font(T.body).foregroundStyle(DS.Color.inkMuted) }
        } actions: { actions() }
        .frame(maxWidth: .infinity).padding(.vertical, DS.Space.space6)
    }

    private var offlineBanner: some View {
        Label("Offline. Showing your saved library.", systemImage: "wifi.slash")
            .font(T.caption).foregroundStyle(DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .dsSlab(radius: DS.Radius.radiusKey)
            .accessibilityElement(children: .combine)
    }

    private func row(_ track: Track, in tracks: [Track]) -> some View {
        let playing = player.current?.id == track.id
        let onPhone = library.contains(track.id)
        let progress = server.transfers[track.id]?.progress
        let hasAudio = onPhone || (track.onServer ?? true)
        let playable = tracks.filter { library.contains($0.id) }
        let start = { player.play(playable, startAt: playable.firstIndex(of: track) ?? 0) }
        let fetch: () -> Void = { Task { if await server.download(track, settings: settings, into: library) { player.playNow(track) } } }
        let getAudio: () -> Void = { server.getAudio(track, settings: settings, library: library, player: player, playWhenReady: false) }
        let playNext = { player.playNext(track); queueTick += 1; toast = "Plays next" }
        let enqueue = {
            if player.enqueue([track]) == 1 { toast = "Added to queue"; queueTick += 1 } else { toast = "Already in queue" }
        }
        let removeAudio = { library.removeAudio(track.id); toast = "Removed from this iPhone" }
        let state: String
        if onPhone { state = "on iPhone" }
        else if progress != nil { state = "downloading \(Int((progress ?? 0) * 100)) percent" }
        else if hasAudio { state = "on server" }
        else { state = "no audio yet" }
        let tap = {
            if onPhone { start() }
            else if !hasAudio { if progress == nil { toast = "No audio yet" } }
            else if progress == nil { fetch() }
        }
        return LibrarySongRow(title: track.title, subtitle: subtitle(track), thumbnail: track.thumbnail,
                    duration: onPhone ? track.duration : nil,
                    downloading: onPhone ? nil : progress,
                    onDownload: !onPhone && progress == nil && hasAudio ? { fetch() } : nil,
                    noAudio: !onPhone && !hasAudio && progress == nil,
                    playing: playing, a11yLabel: "\(track.title), \(track.artist), \(state)", onTap: tap, actions: {
            Button("Edit") { editing = ServerSong(track) }
            if onPhone {
                Button("Play next", action: playNext)
                Button("Add to queue", action: enqueue)
                if track.localOnly != true { Button("Remove from iPhone", action: removeAudio) }
            } else if !hasAudio, progress == nil { Button("Get audio", action: getAudio) }
            Button("Delete") { deleting = track }
        }) {
                Menu {
                    Button { editing = ServerSong(track) } label: { Label("Edit", systemImage: "pencil") }
                    if onPhone {
                        Button(action: playNext) { Label("Play next", systemImage: "text.insert") }
                        Button(action: enqueue) { Label("Add to queue", systemImage: "text.badge.plus") }
                        if track.localOnly != true {
                            Button(action: removeAudio) {
                                Label("Remove from iPhone", systemImage: "iphone.slash")
                            }
                        }
                    } else if hasAudio, progress == nil {
                        Button { fetch() } label: { Label("Download", systemImage: "arrow.down.circle") }
                    } else if progress == nil {
                        Button { getAudio() } label: { Label("Get audio", systemImage: "arrow.down.circle") }
                    }
                    Button(role: .destructive) { deleting = track } label: { Label("Delete from library", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: moreSize)).foregroundStyle(playing ? DS.Color.accentInk : DS.Color.inkFaint)
                        .frame(width: moreWidth, height: DS.Space.hit)
                        .contentShape(Rectangle().inset(by: -10))
                }
                .accessibilityLabel("More actions for \(track.title)")
            }
        .contextMenu {
            Button { editing = ServerSong(track) } label: { Label("Edit", systemImage: "pencil") }
            if onPhone {
                Button(action: playNext) { Label("Play next", systemImage: "text.insert") }
                Button(action: enqueue) { Label("Add to queue", systemImage: "text.badge.plus") }
            }
            Button(role: .destructive) { deleting = track } label: { Label("Delete from library", systemImage: "trash") }
        }
    }

    private func delete(_ t: Track) async {
        if t.localOnly != true {
            do { try await APIClient(baseURL: settings.serverURL, token: settings.token).delete(t.id) }
            catch APIError.http(404, _) { library.delete(t.id); return }
            catch { toast = "Couldn't delete. Check the server and try again."; return }
        }
        library.delete(t.id)
    }
}

struct LibrarySongRow<Menu: View, Actions: View>: View {
    let title: String
    let subtitle: String
    let thumbnail: String?
    var duration: Double?
    var downloading: Double?
    var onDownload: (() -> Void)?
    var noAudio = false
    var playing = false
    let a11yLabel: String
    let onTap: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var coverSize: CGFloat = 56
    @ViewBuilder var actions: () -> Actions
    @ViewBuilder var menu: () -> Menu

    var body: some View {
        HStack(spacing: DS.Space.space3) {
            Button(action: onTap) {
                HStack(spacing: DS.Space.space3) {
                    CoverImage(source: thumbnail)
                        .frame(width: coverSize, height: coverSize)
                        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                        .opacity(noAudio ? 0.55 : 1)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                        Text(subtitle).font(T.subhead).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted).lineLimit(1)
                    }
                    .opacity(noAudio ? 0.55 : 1)
                    Spacer(minLength: 0)
                    if onDownload == nil {
                        if noAudio {
                            Text("No audio yet").font(T.caption).foregroundStyle(DS.Color.inkMuted)
                                .multilineTextAlignment(.trailing).frame(maxWidth: 84, alignment: .trailing).fixedSize(horizontal: false, vertical: true)
                        } else if let downloading {
                            Text("Downloading \(Int(downloading * 100))%").font(T.caption).foregroundStyle(DS.Color.accentInk)
                                .lineLimit(typeSize.isAccessibilitySize ? 2 : 1).multilineTextAlignment(.trailing)
                                .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
                        } else if let duration {
                            Text(formatTime(duration)).font(T.time).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted)
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(a11yLabel)
            .accessibilityAddTraits(playing ? .isSelected : [])
            .accessibilityActions { actions() }
            if let onDownload {
                Button(action: onDownload) {
                    Text("Download").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
                        .overlay(Capsule().stroke(DS.Color.accentInk, lineWidth: 1.5))
                        .contentShape(Capsule().inset(by: -6))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Download \(title)")
            }
            menu()
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space3)
        .frame(minHeight: DS.Space.hit)
        .background(playing ? DS.Color.accentTint : Color.clear)
    }
}
