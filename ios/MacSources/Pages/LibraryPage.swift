import SwiftUI
import UniformTypeIdentifiers

struct LibraryPage: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var nav: MacNavigation
    @ObservedObject private var ui = LibraryUIState.shared
    @State private var filterSheet: FilterCategory?
    @State private var card: Track?
    @State private var form: SongFormTarget?

    private func hasAudio(_ t: Track) -> Bool { library.contains(t.id) || (t.onServer ?? true) }

    private var counts: [(tag: String, count: Int)] { tagCounts(library.songs.map { $0.tags ?? [] }) }

    private func haystack(_ t: Track) -> [String] {
        [t.title, t.artist, t.album ?? "", t.remixer ?? ""] + (t.tags ?? []).flatMap { [$0, tagLabel($0)] }
    }

    private func compare(_ a: String, _ b: String) -> ComparisonResult {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive])
    }

    private func firstArtist(_ t: Track) -> String {
        Tokens.tokenize(t.artist).first?.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? t.artist
    }

    private var shown: [Track] {
        var list = library.songs.filter { libFilterMatches($0, selection: ui.filters) }
        let q = ui.search.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty { list = list.filter { t in haystack(t).contains { $0.lowercased().contains(q) } } }
        let order = Dictionary(uniqueKeysWithValues: list.enumerated().map { ($1.id, $0) })
        switch ui.sort {
        case .added:
            list.sort {
                let a = $0.addedAt ?? .distantPast, b = $1.addedAt ?? .distantPast
                return a == b ? order[$0.id, default: 0] < order[$1.id, default: 0] : a > b
            }
        case .title: list.sort { compare($0.title, $1.title) == .orderedAscending }
        case .artist:
            list.sort {
                let c = compare(firstArtist($0), firstArtist($1))
                return c == .orderedSame ? compare($0.title, $1.title) == .orderedAscending : c == .orderedAscending
            }
        case .year: list.sort { ($0.year ?? -1) > ($1.year ?? -1) }
        case .bpm: list.sort { ($0.bpm ?? .infinity) < ($1.bpm ?? .infinity) }
        }
        return list
    }

    private var callbacks: LibRowCallbacks {
        LibRowCallbacks(
            playNow: { play($0) },
            coverTap: { cover($0) },
            open: { card = $0 },
            toggleQueue: { toggleQueue($0) },
            fetch: { fetch($0, play: false) },
            edit: { form = .edit($0) })
    }

    var body: some View {
        let list = shown
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: DS.Space.space3) {
                header
                chips
                sortBar(list)
                content(list, width: geo.size.width - 2 * DS.Space.space6)
            }
            .padding(.horizontal, DS.Space.space6).padding(.top, DS.Space.space4)
        }
        .background(DS.Color.ground)
        .navigationTitle("Library")
        .searchable(text: $ui.search, placement: .toolbar, prompt: "Search title, artist, album, remix or tag")
        .toolbar { ToolbarItem { sortMenu } }
        .sheet(item: $filterSheet) { category in
            let values = category.values(counts)
            LibFilterSheet(category: category, values: values, unsetCount: unsetCount(category),
                           selection: $ui.filters, resultCount: shown.count)
        }
        .sheet(item: $card) { t in
            LibSongCard(trackID: t.id, callbacks: callbacks, close: { card = nil }, edit: { card = nil; form = .edit($0) })
        }
        .sheet(item: $form) { MacSongFormSheet(target: $0) }
        .libToast($ui.toast)
        .onChange(of: server.notice) { _, n in
            if let n { ui.toast = n; server.notice = nil }
        }
        .onDrop(of: [.url, .plainText], isTargeted: nil) { providers in drop(providers) }
        .task { await server.syncCatalog(settings: settings, library: library, auto: false) }
        .onReceive(NotificationCenter.default.publisher(for: .macRevealPlayingSong)) { n in
            guard let id = n.object as? String else { return }
            if shown.contains(where: { $0.id == id }) {
                ui.rowSelection = id
                ui.revealID = id
            } else {
                ui.toast = "Song is hidden by the current filters"
            }
        }
        .onChange(of: nav.addRequested, initial: true) { _, requested in
            guard requested else { return }
            nav.addRequested = false
            form = .add("")
        }
    }

    private func unsetCount(_ c: FilterCategory) -> Int {
        guard c.unsetToken != nil else { return 0 }
        return library.songs.filter { t in !(t.tags ?? []).contains { c.owns($0) } }.count
    }

    private var header: some View {
        LibPageHeader(title: "Library") {
            HStack(spacing: DS.Space.space3) {
                Text("\(library.songs.count) \(library.songs.count == 1 ? "song" : "songs")").dsCaption()
                Button { form = .add("") } label: { Label("Add song", systemImage: "plus") }
                    .buttonStyle(LibLitButtonStyle())
            }
        }
    }

    private var chips: some View {
        HStack(spacing: DS.Space.space2) {
            ForEach(FilterCategory.allCases) { c in
                let values = c.values(counts)
                let selected = ui.filters.filter { c.owns($0) }.count
                let on = selected > 0
                Button { filterSheet = c } label: {
                    HStack(spacing: DS.Space.space1) {
                        Text(c.rawValue).font(T.subhead.weight(on ? .semibold : .medium))
                        Text("\(on ? selected : values.count)").font(T.caption)
                    }
                    .foregroundStyle(on ? DS.Color.onAccent : DS.Color.ink)
                    .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
                    .background {
                        if on { Capsule().fill(DS.Color.accent) }
                        else { Capsule().fill(DS.Color.surface).shadow(color: DS.Color.vinyl.opacity(0.16), radius: 6, y: 1) }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(values.isEmpty && unsetCount(c) == 0)
                .accessibilityLabel("\(c.rawValue), \(on ? "\(selected) selected" : "\(values.count)")")
            }
            Spacer()
        }
    }

    private var sortMenu: some View {
        Menu {
            Picker("Sort", selection: $ui.sort) { ForEach(LibSort.allCases) { Text($0.rawValue).tag($0) } }
        } label: {
            Label("Sort: \(ui.sort.rawValue)", systemImage: "arrow.up.arrow.down")
        }
        .help("Sort the library")
    }

    private func statusLine(_ list: [Track]) -> String {
        guard ui.filtersActive else { return "" }
        let names = ui.filters.map { tag in
            tag.hasSuffix("__unset__") ? FilterCategory.allCases.first { $0.unsetToken == tag }?.unsetLabel ?? tag : tagLabel(tag)
        }.sorted()
        let n = "\(list.count) \(list.count == 1 ? "song matches" : "songs match")"
        return names.isEmpty ? n : n + " \u{00B7} " + names.prefix(3).joined(separator: ", ")
    }

    private func sortBar(_ list: [Track]) -> some View {
        HStack(spacing: DS.Space.space3) {
            Text(statusLine(list)).font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            Spacer()
            if !list.isEmpty {
                Button("Play all \(list.count)") { playAll(list) }.buttonStyle(LibOutlineButtonStyle())
                if ui.filtersActive {
                    Button("Add all \(list.count) to playlist") { addAll(list) }.buttonStyle(LibOutlineButtonStyle())
                }
            }
        }
        .frame(minHeight: 36)
    }

    @ViewBuilder
    private func content(_ list: [Track], width: CGFloat) -> some View {
        if library.songs.isEmpty {
            emptyState
        } else if list.isEmpty {
            stateBox("No songs match. Clear the search or the filters.") {
                Button("Clear") { ui.clearFilters() }.buttonStyle(LibOutlineButtonStyle())
            }
        } else {
            table(list, width: width)
        }
    }

    private func table(_ list: [Track], width: CGFloat) -> some View {
        VStack(spacing: 0) {
            columnHeader(width: width)
            ScrollViewReader { proxy in
                List(selection: $ui.rowSelection) {
                    ForEach(list) { t in
                        LibRowView(track: t, width: width, playing: player.current?.id == t.id,
                                   playingNow: player.current?.id == t.id && player.isPlaying,
                                   hasAudio: hasAudio(t), inQueue: player.queue.contains { $0.id == t.id },
                                   fetch: ui.fetches[t.id], cb: callbacks)
                            .tag(t.id)
                            .id(t.id)
                            .listRowInsets(EdgeInsets(top: 0, leading: DS.Space.space3, bottom: 0, trailing: DS.Space.space3))
                            .listRowSeparatorTint(DS.Color.line)
                            .listRowBackground(player.current?.id == t.id ? DS.Color.accentTint : Color.clear)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .contextMenu(forSelectionType: String.self) { ids in
                    if let id = ids.first, let t = library.songs.first(where: { $0.id == id }) {
                        LibTrackMenu(track: t, hasAudio: hasAudio(t), inQueue: player.queue.contains { $0.id == t.id },
                                     fetching: ui.fetches[t.id] != nil, cb: callbacks)
                    }
                } primaryAction: { ids in
                    if let id = ids.first, let t = library.songs.first(where: { $0.id == id }) { play(t) }
                }
                .onChange(of: ui.revealID) { _, id in
                    guard let id else { return }
                    withAnimation { proxy.scrollTo(id, anchor: .center) }
                    ui.revealID = nil
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous).fill(DS.Color.surface))
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous))
        .padding(.bottom, DS.Space.space4)
    }

    private func columnHeader(width: CGFloat) -> some View {
        let layout = LibColumns(width: width)
        return HStack(spacing: DS.Space.space3) {
            Color.clear.frame(width: 60)
            Text("TRACK").frame(width: layout.track, alignment: .leading).frame(maxWidth: layout.genres ? nil : .infinity, alignment: .leading)
            if layout.genres { Text("GENRES").frame(maxWidth: .infinity, alignment: .leading) }
            Text("TIME").frame(width: 64, alignment: .leading)
            Color.clear.frame(width: 32 + 28 + DS.Space.space3)
        }
        .font(DS.Font.eyebrow).tracking(DS.Font.eyebrowTracking).foregroundStyle(DS.Color.inkMuted)
        .padding(.horizontal, DS.Space.space3).frame(height: 32)
        .overlay(alignment: .bottom) { Rectangle().fill(DS.Color.line).frame(height: 1) }
        .accessibilityHidden(true)
    }

    @ViewBuilder private var emptyState: some View {
        if server.forbidden {
            stateBox(APIError.forbiddenMessage) { EmptyView() }
        } else if !ServerLink.hasCredentials(settings) {
            stateBox("Sign in to see your library, add songs and play them.") {
                Button("Sign in") { nav.showSignIn = true }.buttonStyle(LibLitButtonStyle())
            }
        } else if server.syncing || (!server.synced && server.failureMessage == nil) {
            stateBox("Loading your library...") { EmptyView() }
        } else if !server.synced {
            stateBox(server.failureMessage ?? "Couldn't load your library. Try again.") {
                Button("Retry") { Task { await server.syncCatalog(settings: settings, library: library, auto: false) } }
                    .buttonStyle(LibOutlineButtonStyle())
            }
        } else {
            stateBox("No songs yet\nPaste a YouTube or SoundCloud link to save the song to your library.") {
                Button { form = .add("") } label: { Label("Add song", systemImage: "plus") }.buttonStyle(LibLitButtonStyle())
            }
        }
    }

    private func stateBox<A: View>(_ text: String, @ViewBuilder actions: () -> A) -> some View {
        let lines = text.components(separatedBy: "\n")
        return VStack(spacing: DS.Space.space3) {
            Text(lines[0]).font(lines.count > 1 ? DS.Font.headline : DS.Font.body).foregroundStyle(lines.count > 1 ? DS.Color.ink : DS.Color.inkMuted)
                .multilineTextAlignment(.center)
            if lines.count > 1 { Text(lines[1]).font(T.subhead).foregroundStyle(DS.Color.inkMuted).multilineTextAlignment(.center) }
            actions()
        }
        .frame(maxWidth: .infinity).padding(DS.Space.space6)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous).fill(DS.Color.surface))
        .accessibilityElement(children: .contain)
    }

    private func play(_ t: Track) {
        guard hasAudio(t) else { fetch(t, play: true); return }
        player.playNow(t)
    }

    private func cover(_ t: Track) {
        if player.current?.id == t.id { player.toggle() } else { play(t) }
    }

    private func fetch(_ t: Track, play: Bool) {
        if ui.fetches[t.id]?.phase == .failed { ui.dismissFailure(t.id) }
        ui.fetch(t, play: play, settings: settings, library: library, server: server, player: player)
        ui.toast = "Downloading \"\(t.title)\" to the server"
    }

    private func toggleQueue(_ t: Track) {
        if let i = player.queue.firstIndex(where: { $0.id == t.id }) {
            player.removeFromQueue(at: IndexSet(integer: i))
            ui.toast = "Removed from playlist"
        } else if hasAudio(t) {
            player.enqueue([t])
            ui.toast = player.queue.count == 1 ? "Queued" : "Added"
        } else if ui.autoDownload {
            fetch(t, play: false)
        } else {
            ui.toast = "Not downloaded. Use Download to the server first."
        }
    }

    private func playAll(_ list: [Track]) {
        var seen = Set<String>()
        let audible = list.filter { hasAudio($0) && seen.insert($0.id).inserted }
        let skipped = list.count - audible.count
        guard !audible.isEmpty else { ui.toast = "No songs with audio to play"; return }
        let upcoming = player.index.map { player.queue.count - $0 - 1 } ?? 0
        player.play(audible, startAt: player.shuffle ? Int.random(in: 0..<audible.count) : 0)
        var msg = "Playing \(audible.count) \(audible.count == 1 ? "song" : "songs")"
        if upcoming > 0 { msg += " (queue replaced)" }
        if skipped > 0 {
            if ui.autoDownload {
                for t in list where !hasAudio(t) { ui.fetch(t, settings: settings, library: library, server: server, player: player) }
                msg += ", \(skipped) downloading"
            } else {
                msg += ", \(skipped) without audio skipped"
            }
        }
        ui.toast = msg
    }

    private func addAll(_ list: [Track]) {
        var seen = Set<String>()
        let audible = list.filter { hasAudio($0) && seen.insert($0.id).inserted }
        let before = player.queue.count
        if ui.filters.count == 1, ui.search.trimmingCharacters(in: .whitespaces).isEmpty, let tag = ui.filters.first, !tag.hasSuffix("__unset__") {
            player.addTagged([tag], from: audible)
        } else {
            player.enqueue(audible)
        }
        let added = player.queue.count - before
        var msg = "Added \(added) \(added == 1 ? "song" : "songs") (\(audible.count - added) already in queue)"
        let rest = list.count - audible.count
        if rest > 0, ui.autoDownload {
            for t in list where !hasAudio(t) { ui.fetch(t, settings: settings, library: library, server: server, player: player) }
            msg += ", \(rest) downloading"
        }
        ui.toast = msg
    }

    private func drop(_ providers: [NSItemProvider]) -> Bool {
        guard let p = providers.first else { return false }
        if p.canLoadObject(ofClass: URL.self) {
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                if let url { Task { @MainActor in form = .add(url.absoluteString) } }
            }
            return true
        }
        if p.canLoadObject(ofClass: String.self) {
            _ = p.loadObject(ofClass: String.self) { text, _ in
                if let text { Task { @MainActor in form = .add(cleanPasted(text)) } }
            }
            return true
        }
        return false
    }
}

struct LibColumns {
    let genres: Bool
    let track: CGFloat

    init(width: CGFloat) {
        genres = width >= 900
        track = width >= 1100 ? 300 : width >= 900 ? 240 : max(200, width - 60 - 64 - 32 - 28 - 4 * DS.Space.space3 - 2 * DS.Space.space3)
    }
}

struct LibRowCallbacks {
    var playNow: (Track) -> Void
    var coverTap: (Track) -> Void
    var open: (Track) -> Void
    var toggleQueue: (Track) -> Void
    var fetch: (Track) -> Void
    var edit: (Track) -> Void
}

/// The row menu; the "..." button and the context menu show the same items.
struct LibTrackMenu: View {
    let track: Track
    let hasAudio: Bool
    let inQueue: Bool
    let fetching: Bool
    let cb: LibRowCallbacks

    var body: some View {
        if hasAudio { Button("Play now") { cb.playNow(track) } }
        Button(inQueue ? "Remove from playlist" : "Add to playlist") { cb.toggleQueue(track) }
        if !hasAudio && !fetching { Button("Download to the server") { cb.fetch(track) } }
        Button("Song info") { cb.open(track) }
        Button("Edit song") { cb.edit(track) }
    }
}

struct LibRowView: View {
    let track: Track
    let width: CGFloat
    let playing: Bool
    let playingNow: Bool
    let hasAudio: Bool
    let inQueue: Bool
    let fetch: SongFetch?
    let cb: LibRowCallbacks
    @State private var hover = false

    private var columns: LibColumns { LibColumns(width: width) }
    private var genres: String {
        (track.tags ?? []).filter { tagKey($0) == "genre" }.map(tagLabel).joined(separator: ", ")
    }

    var body: some View {
        HStack(spacing: DS.Space.space3) {
            coverButton
            trackColumn
            if columns.genres { genreColumn }
            timeCell.frame(width: 64, alignment: .leading)
            queueToggle
            menu
        }
        .frame(height: 76)
        .overlay(alignment: .bottom) {
            if let fetch, fetch.phase == .running, fetch.progress > 0 {
                GeometryReader { g in
                    Rectangle().fill(DS.Color.accent).frame(width: g.size.width * fetch.progress, height: 2)
                }.frame(height: 2)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var coverButton: some View {
        Button { cb.coverTap(track) } label: {
            LibCover(source: track.thumbnail)
                .frame(width: 60, height: 60)
                .opacity(hasAudio ? 1 : 0.55)
                .overlay {
                    if playing || hover {
                        Circle().fill(DS.Color.vinyl.opacity(playing ? 0.75 : 0.6)).frame(width: 30, height: 30)
                            .overlay(Image(systemName: playingNow ? "pause.fill" : "play.fill").font(.system(size: 12)).foregroundStyle(DS.Color.accent))
                    }
                }
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityLabel(!hasAudio ? "Download \(track.title)" : playingNow ? "Pause \(track.title)" : "Play \(track.title)")
    }

    private var trackColumn: some View {
        Button { cb.open(track) } label: {
            VStack(alignment: .leading, spacing: 2) {
                let remix = SongName.remix(track)
                (Text(track.title).font(DS.Font.subheadStrong).foregroundStyle(hasAudio ? DS.Color.ink : DS.Color.inkMuted)
                 + Text(remix.isEmpty ? "" : " (\(remix))").font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted))
                    .lineLimit(1)
                Text(SongName.subtitle(track)).font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(width: columns.genres ? columns.track : nil)
        .frame(maxWidth: columns.genres ? nil : .infinity, alignment: .leading)
        .help(SongName.displayLine(track))
        .accessibilityLabel("Open: \(track.title)")
    }

    private var genreColumn: some View {
        HStack(spacing: DS.Space.space2) {
            Group {
                if let bpm = track.bpm {
                    HStack(spacing: 2) {
                        Text("\(Int(bpm.rounded()))").font(DS.Font.time)
                        Text("BPM").font(.system(size: 8, weight: .semibold))
                    }
                    .foregroundStyle(DS.Color.inkMuted)
                    .padding(.horizontal, 6).frame(height: 20)
                    .overlay(Capsule().stroke(DS.Color.line, lineWidth: 1))
                    .help("Beats per minute (estimated)")
                    .accessibilityLabel("BPM \(Int(bpm.rounded()))")
                } else {
                    Color.clear
                }
            }
            .frame(width: 58, alignment: .leading)
            Text(genres).font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 120, maxWidth: .infinity)
    }

    @ViewBuilder private var timeCell: some View {
        if let fetch {
            LibFetchRing(fetch: fetch) { cb.fetch(track) }
        } else if hasAudio {
            Text(track.duration.map(macTime) ?? "").font(DS.Font.time).foregroundStyle(DS.Color.inkMuted)
        } else {
            HStack(spacing: 2) {
                if let link = LibLinks.source(track) {
                    ServiceIcon(kind: link.kind, active: true, url: link.url, size: 18)
                        .help("Open on \(link.kind.label)")
                }
                Button { cb.fetch(track) } label: {
                    Image(systemName: "arrow.down.circle").font(.system(size: 16)).foregroundStyle(DS.Color.accentInk)
                        .frame(width: 28, height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain).help("Download to the server").accessibilityLabel("Download to the server")
            }
        }
    }

    private var queueToggle: some View {
        Button { cb.toggleQueue(track) } label: {
            Image(systemName: inQueue ? "checkmark" : "plus").font(.system(size: 12, weight: .bold))
                .foregroundStyle(inQueue ? DS.Color.onAccent : DS.Color.accentInk)
                .frame(width: 28, height: 28)
                .background(Circle().fill(inQueue ? DS.Color.accent : Color.clear))
                .overlay(Circle().stroke(inQueue ? Color.clear : DS.Color.line, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .frame(width: 32)
        .help(inQueue ? "In playlist - click to remove" : "Add to playlist")
        .accessibilityLabel(inQueue ? "In playlist - click to remove" : "Add to playlist")
    }

    private var menu: some View {
        Menu {
            LibTrackMenu(track: track, hasAudio: hasAudio, inQueue: inQueue, fetching: fetch != nil, cb: cb)
        } label: {
            Image(systemName: "ellipsis").foregroundStyle(DS.Color.inkMuted).frame(width: 28, height: 28)
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden)
        .frame(width: 28)
        .accessibilityLabel("More: \(track.title)")
    }
}

struct LibFetchRing: View {
    let fetch: SongFetch
    let retry: () -> Void

    var body: some View {
        switch fetch.phase {
        case .failed:
            Button(action: retry) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(DS.Color.power).frame(width: 28, height: 28)
            }
            .buttonStyle(.plain).help("Failed - click to retry").accessibilityLabel("Failed - click to retry")
        case .queued:
            Circle().stroke(DS.Color.inkFaint, style: StrokeStyle(lineWidth: DS.Stroke.strokeProgress, dash: [3, 3]))
                .frame(width: 24, height: 24).frame(width: 28, height: 28).help("Queued").accessibilityLabel("Queued")
        case .converting:
            ProgressView().controlSize(.small).frame(width: 28, height: 28).help("Converting").accessibilityLabel("Converting")
        case .running:
            let pct = Int((fetch.progress * 100).rounded())
            ZStack {
                Circle().stroke(DS.Color.surfaceSunken, lineWidth: DS.Stroke.strokeProgress)
                Circle().trim(from: 0, to: fetch.progress).stroke(DS.Color.accent, style: StrokeStyle(lineWidth: DS.Stroke.strokeProgress, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(pct)").font(DS.Font.micro).foregroundStyle(DS.Color.ink)
            }
            .frame(width: 28, height: 28)
            .accessibilityElement().accessibilityLabel("Downloading \(pct)%")
        }
    }
}

/// The stored links of a song, as the service icons show them.
enum LibLinks {
    static func url(_ s: String?) -> URL? {
        let t = (s ?? "").trimmingCharacters(in: .whitespaces)
        return t.lowercased().hasPrefix("http") ? URL(string: t) : nil
    }

    static func source(_ t: Track) -> (kind: ServiceKind, url: URL)? {
        let own = sourceOf(id: t.id)
        let kind: ServiceKind = own == "soundcloud" ? .soundcloud : .youtube
        if let u = url(t.sourceURL) { return (kind, u) }
        if let u = (t.sources ?? []).compactMap({ url($0.url) }).first { return (kind, u) }
        if kind == .youtube, let u = URL(string: "https://www.youtube.com/watch?v=\(t.id)"), own == "youtube" { return (.youtube, u) }
        return nil
    }
}
