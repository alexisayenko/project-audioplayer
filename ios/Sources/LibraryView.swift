import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var player: PlayerService
    @EnvironmentObject private var settings: Settings
    @EnvironmentObject private var server: ServerLink
    @EnvironmentObject private var anon: AnonDownloader
    @EnvironmentObject private var query: LibraryQuery
    @EnvironmentObject private var listening: ListeningStore
    @ObservedObject private var auth = AuthService.shared
    @Environment(\.openSettings) private var openSettings
    @State private var facet: LibraryFacet?
    @State private var showHiddenPlaying = false
    @State private var pendingReveal: String?
    @State private var showSort = false
    var mode: Binding<LibraryMode>?
    @State private var showAdd = false
    @State private var playlistSongs: [String] = []
    @State private var editing: ServerSong?
    @State private var path: [String] = []
    @State private var toast: String?
    @State private var toastID = 0
    @State private var queueTick = 0
    @State private var deleteTick = 0
    @State private var scrolledPast = false
    @State private var toolsHeight: CGFloat = 0
    @State private var chipEnd: CGFloat = 0
    @State private var resetScroll = 0
    @State private var returnIndex = 0
    @State private var pinnedHeight: CGFloat = 0
    @AccessibilityFocusState private var rowFocus: String?
    @AccessibilityFocusState private var facetFocus: LibraryFacet?
    @AccessibilityFocusState private var errorFocus: Bool

    private var signedIn: Bool { ServerLink.hasCredentials(settings) }
    private var songs: [Track] { signedIn ? library.songs : library.tracks }
    private var tracks: [Track] {
        query.results(songs, phoneIDs: library.phoneIDs, listening: listening.entries,
                      stamp: LibraryQuery.DataStamp(phoneOnly: !signedIn, library: library.revision, listening: listening.revision))
    }
    private var accountKey: String {
        [settings.serverURL, settings.token, auth.session?.email ?? "", auth.session?.provider.rawValue ?? ""].joined(separator: "|")
    }
    private var arriving: [Track] {
        (Array(server.transfers.values) + Array(anon.transfers.values)).map(\.track)
            .filter { track in !library.songs.contains { $0.id == track.id } }.sorted { $0.id < $1.id }
    }
    private var loading: Bool {
        signedIn && songs.isEmpty && (server.syncing || !server.synced && server.failureMessage == nil)
    }
    private var failed: Bool { signedIn && songs.isEmpty && !loading && (!server.synced || server.forbidden) }
    private var hideTools: Bool { !signedIn && songs.isEmpty && arriving.isEmpty }

    var body: some View {
        let matches = tracks
        let queued = Set(player.queue.map(\.id))
        NavigationStack(path: $path) {
            GeometryReader { screen in
                ScrollViewReader { proxy in
                    VStack(spacing: 0) {
                        pinnedHeader(matches, proxy: proxy)
                        ScrollView {
                            VStack(spacing: DS.Space.space3) {
                                Color.clear.frame(height: 0).id("library.top")
                                    .background(GeometryReader { geometry in
                                        Color.clear.preference(key: LibraryScrollOffset.self, value: geometry.frame(in: .named("library.scroll")).minY)
                                    })
                                if !hideTools { libraryTools }
                                if signedIn && server.reachable == false && !songs.isEmpty { offlineBanner }
                                content(matches, queued: queued)
                                    .frame(minHeight: !loading && (songs.isEmpty || matches.isEmpty) && arriving.isEmpty
                                           ? max(0, screen.size.height - pinnedHeight - toolsHeight - DS.Space.space3 - DS.Space.space4) : nil)
                            }
                            .padding(.horizontal, DS.Space.space4).padding(.bottom, DS.Space.space4)
                            .frame(maxWidth: .infinity)
                        }
                        .dockClearance()
                        .coordinateSpace(name: "library.scroll")
                        .scrollDismissesKeyboard(.interactively).onPreferenceChange(LibraryScrollOffset.self, perform: scrolled)
                        .refreshable { await refresh() }
                        .onChange(of: query.search) { _, _ in scrollTop(proxy) }
                        .onChange(of: query.sort) { _, _ in scrollTop(proxy) }
                        .onChange(of: query.reversed) { _, _ in scrollTop(proxy) }
                        .onChange(of: resetScroll) { _, _ in scrollTop(proxy) }
                        .confirmationDialog("Song is hidden by the current filters", isPresented: $showHiddenPlaying, titleVisibility: .visible) {
                            Button("Show") {
                                pendingReveal = player.current?.id
                                query.clear()
                            }
                        }
                        .onChange(of: tracks.map(\.id)) { _, ids in
                            guard let id = pendingReveal, ids.contains(id) else { return }
                            pendingReveal = nil
                            Task { @MainActor in
                                await Task.yield()
                                reveal(id, proxy: proxy)
                            }
                        }
                        .sheet(isPresented: $showSort) {
                            LibrarySortSheet(listeningAvailable: signedIn && listening.loaded, scrollTop: { scrollTop(proxy) })
                        }
                        .sheet(item: $facet) { category in
                            LibraryFilterSheet(category: category, values: category.values(songs), selection: $query.selection,
                                               resultCount: { tracks.count }).onDisappear { facetFocus = category }
                        }
                    }
                }
            }
            .dsGround().toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                SongDetailsView(id: id, play: { track in play(track, in: tracks) }, download: download, notify: notify,
                                deleted: { track in deleteTick += 1; path = []; notify("Deleted \"\(track.title)\"") })
            }
        }
        .sheet(isPresented: $showAdd) { AddSheet() }.sheet(item: $editing) { SongEditView(song: $0) }
        .sheet(isPresented: Binding(get: { !playlistSongs.isEmpty }, set: { if !$0 { playlistSongs = [] } })) {
            PlaylistPickerSheet(songIDs: playlistSongs) { notify($0) }
        }
        .overlay(alignment: .top) { toastView }
        .sensoryFeedback(.success, trigger: queueTick).sensoryFeedback(.warning, trigger: deleteTick)
        .task(id: accountKey) { await listening.load(settings: settings, signedIn: signedIn, reset: true) }
        .onChange(of: accountKey) { _, _ in query.clear(); path = []; resetScroll += 1 }
        .onChange(of: listening.loaded) { _, loaded in if !loaded { query.neverListened = false } }
        .onChange(of: signedIn) { _, value in if !value { query.clear(); path = [] } }
        .onChange(of: path) { old, new in
            if new.isEmpty, let id = old.last {
                if tracks.contains(where: { $0.id == id }) { rowFocus = id }
                else { rowFocus = tracks.isEmpty ? nil : tracks[min(returnIndex, tracks.count - 1)].id }
            }
        }
        .onChange(of: library.phoneIDs) { _, _ in server.reconcile(library) }
        .onChange(of: server.notice) { _, note in if let note { notify(note); server.notice = nil } }
        .onChange(of: anon.notice) { _, note in if let note { notify(note); anon.notice = nil } }
    }

    private var header: some View {
        ScreenHeader(title: "Library") {
            Button { hideKeyboard(); showAdd = true } label: {
                Image(systemName: "plus").dsIcon(DS.Icon.iconNavLg, weight: DS.Icon.iconWeightStrong)
                    .foregroundStyle(DS.Color.onAccent).frame(width: DS.Space.hit, height: DS.Space.hit)
                    .background(Circle().fill(DS.Color.accent).dsShadow(DS.Shadow.depthGlowSoft))
            }.buttonStyle(LibraryPressStyle()).accessibilityLabel("Add a song")
        }.padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2)
    }

    private func pinnedHeader(_ matches: [Track], proxy: ScrollViewProxy) -> some View {
        VStack(spacing: 0) {
            header
            if signedIn, let mode { LibraryModeSwitch(mode: mode).padding(.horizontal, DS.Space.space4) }
            if !hideTools {
                LibraryControls(matches: matches.count, total: songs.count,
                                enabled: !matches.isEmpty && !loading && !failed,
                                canShowPlaying: player.current.map { current in songs.contains { $0.id == current.id } } ?? false,
                                showPlaying: { showPlaying(proxy) },
                                sort: { hideKeyboard(); showSort = true }, play: { playMatched(matches) },
                                scrollTop: { scrollTop(proxy) }).padding(.horizontal, DS.Space.space4)
            }
            LibraryHairline().opacity(scrolledPast ? 1 : 0)
        }
        .background(DS.Color.ground)
        .measuredHeight($pinnedHeight)
    }

    private var libraryTools: some View {
        VStack(spacing: 0) {
            LibrarySearchField(text: $query.search)
            chipRow.padding(.horizontal, -DS.Space.space4)
        }
        .measuredHeight($toolsHeight)
        .accessibilityHidden(facet != nil)
    }

    private var chipRow: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DS.Space.space2) {
                    ForEach(LibraryFacet.allCases) { category in
                        let selected = query.selection.filter { $0.hasPrefix(category.prefix) }.count
                        LibraryFilterChip(title: category.title, symbol: category.symbol, selected: selected > 0, count: selected) {
                            hideKeyboard(); facet = category
                        }.accessibilityFocused($facetFocus, equals: category)
                    }
                    if signedIn && listening.loaded {
                        LibraryFilterChip(title: "Never listened", symbol: "speaker.slash", selected: query.neverListened,
                                          hint: "Shows only songs you have not played") { query.neverListened.toggle() }
                    }
                    if signedIn {
                        LibraryFilterChip(title: "Downloaded", symbol: "iphone", selected: query.downloadedOnly,
                                          hint: "Shows only songs on this iPhone") { query.downloadedOnly.toggle() }
                    }
                    Color.clear.frame(width: 0, height: 0).background(GeometryReader { marker in
                        Color.clear.preference(key: LibraryChipEnd.self, value: marker.frame(in: .named("library.chips")).maxX)
                    })
                }.padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space2)
            }
            .frame(height: DS.Space.hit + DS.Space.space2 * 2)
            .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            .coordinateSpace(name: "library.chips").onPreferenceChange(LibraryChipEnd.self) { chipEnd = $0 }
            .mask {
                HStack(spacing: 0) {
                    Rectangle()
                    if chipEnd > geometry.size.width {
                        LinearGradient(colors: [DS.Color.ink, .clear], startPoint: .leading, endPoint: .trailing).frame(width: DS.Component.chipFade)
                    }
                }
            }
        }.frame(height: DS.Space.hit + DS.Space.space2 * 2)
    }

    @ViewBuilder private func content(_ matches: [Track], queued: Set<String>) -> some View {
        if loading { LibrarySkeleton() }
        else if failed {
            LibraryEmpty(title: server.forbidden ? "Access denied" : "Can't reach the server", symbol: server.forbidden ? "lock.slash" : "wifi.slash",
                         detail: server.forbidden ? APIError.forbiddenMessage : "Check the connection and try again.") {
                Button("Retry") { Task { await refresh(); errorFocus = true } }.buttonStyle(LibraryPrimaryStyle())
            }.accessibilityFocused($errorFocus)
        } else if songs.isEmpty && arriving.isEmpty {
            LibraryEmpty(title: "No songs yet", symbol: "music.note",
                         detail: signedIn ? "Add a song to start your library." : "Your library is stored on this iPhone. Paste a YouTube or SoundCloud link to add songs, or sign in to search and sync.") {
                Button("Add song") { showAdd = true }.buttonStyle(LibraryPrimaryStyle())
                if !signedIn { Button("Sign in") { openSettings?() }.buttonStyle(DSButtonStyle(kind: .outline)) }
            }
        } else if matches.isEmpty && arriving.isEmpty {
            LibraryEmpty(title: "No songs found", symbol: "magnifyingglass", detail: "Try a different search or clear the filters.") {
                if query.narrowing {
                    Button("Clear filters") { hideKeyboard(); query.clear() }.buttonStyle(DSButtonStyle(kind: .outline))
                }
            }
        } else {
            LazyVStack(spacing: 0) {
                ForEach(arriving) { track in
                    LiveProgress(id: track.id, tracked: server.transfers[track.id] != nil, fallback: anon.transfers[track.id]?.progress ?? 0) { progress in
                        LibrarySongRow(track: track, progress: progress ?? 0,
                                       onPhone: false, playing: false, isPlaying: false, queued: false,
                                       waiting: server.waiting.contains(track.id), arriving: true, play: LibrarySongRow.inert, details: LibrarySongRow.inert, download: LibrarySongRow.inert)
                    }
                    LibraryHairline().padding(.horizontal, DS.Space.space3)
                }
                ForEach(Array(matches.enumerated()), id: \.element.id) { index, track in
                    row(track, matches: matches, queued: queued.contains(track.id)).id(track.id)
                    if index < matches.count - 1, player.current?.id != track.id, player.current?.id != matches[index + 1].id {
                        LibraryHairline().padding(.horizontal, DS.Space.space3)
                    }
                }
            }.clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).librarySlab()
        }
    }

    private func row(_ track: Track, matches: [Track], queued: Bool) -> some View {
        let onPhone = library.contains(track.id)
        let current = player.current?.id == track.id
        let tracked = server.transfers[track.id] != nil
        let anonymous = anon.transfers[track.id]?.progress
        let transferring = tracked || anonymous != nil
        return LiveProgress(id: track.id, tracked: tracked, fallback: anonymous) { progress in
            LibrarySongRow(track: track, progress: progress, onPhone: onPhone, playing: current, isPlaying: player.isPlaying,
                           queued: queued, waiting: server.waiting.contains(track.id), offline: signedIn && server.reachable == false, retry: server.failed.contains(track.id),
                           listenedCount: signedIn && listening.loaded ? listening.entries[track.id]?.listened?.all ?? 0 : nil,
                           toggleQueue: onPhone && !current ? { toggleQueued(track) } : nil,
                           play: { hideKeyboard(); play(track, in: matches) },
                           details: { openDetails(track, matches: matches) }, download: { download(track) })
        }
            .contextMenu { menu(track, onPhone: onPhone, current: current, transferring: transferring) }
            .accessibilityFocused($rowFocus, equals: track.id)
            .accessibilityActions {
                Button("Show details") { openDetails(track, matches: matches) }
                if onPhone && !current {
                    Button("Play next") { playNext(track) }
                    Button(queued ? "Remove from queue" : "Add to queue") { toggleQueued(track) }
                }
                if signedIn { Button("Edit") { editing = ServerSong(track) } }
                if signedIn { Button("Add to playlist") { playlistSongs = [track.id] } }
                if signedIn && !onPhone && !transferring {
                    if track.onServer != false { Button("Download") { download(track) } }
                    else { Button("Get audio") { getAudio(track) } }
                }
                if onPhone && !current && track.localOnly != true && signedIn {
                    Button("Remove from iPhone") { removeAudio(track) }
                }
            }
    }
    @ViewBuilder private func menu(_ track: Track, onPhone: Bool, current: Bool, transferring: Bool) -> some View {
        if onPhone && !current {
            Button { playNext(track) } label: { Label("Play next", systemImage: "text.insert") }
            Button { enqueue(track) } label: { Label("Add to queue", systemImage: "text.badge.plus") }
        }
        if signedIn && !onPhone && !transferring {
            if track.onServer != false { Button { download(track) } label: { Label("Download", systemImage: "arrow.down.circle") } }
            else { Button { getAudio(track) } label: { Label("Get audio", systemImage: "arrow.down.circle") } }
        }
        if signedIn { Button { editing = ServerSong(track) } label: { Label("Edit", systemImage: "pencil") } }
        if signedIn { Button { playlistSongs = [track.id] } label: { Label("Add to playlist", systemImage: "music.note.list") } }
        if signedIn && onPhone && !current && track.localOnly != true {
            Button(role: .destructive) { removeAudio(track) } label: { Label("Remove from iPhone", systemImage: "iphone.slash") }
        }
    }
    private func play(_ track: Track, in matches: [Track]) {
        if library.contains(track.id) {
            if player.current?.id == track.id { player.toggle(); return }
            let phone = matches.filter { library.contains($0.id) }
            guard let index = phone.firstIndex(where: { $0.id == track.id }) else { return }
            player.play(phone, startAt: index)
        } else if server.transfers[track.id] != nil || anon.transfers[track.id] != nil { notify("Already downloading") }
        else if track.onServer == false { notify("No audio yet") }
        else { download(track) }
    }
    private func openDetails(_ track: Track, matches: [Track]) {
        hideKeyboard(); returnIndex = matches.firstIndex(where: { $0.id == track.id }) ?? 0; path.append(track.id)
    }
    private func playMatched(_ matches: [Track]) {
        hideKeyboard()
        let phone = matches.filter { library.contains($0.id) }
        guard !phone.isEmpty else { notify("No listed songs are on this iPhone"); return }
        player.playAll(phone); queueTick += 1
        let skipped = matches.count - phone.count
        notify("Playing \(phone.count) \(phone.count == 1 ? "song" : "songs")" + (skipped > 0 ? ", \(skipped) not on this iPhone skipped" : ""))
    }
    private func download(_ track: Track) {
        hideKeyboard()
        guard signedIn else { return }
        guard server.reachable != false else { notify("Can't reach the server"); return }
        Task { _ = await server.download(track, settings: settings, into: library) }
    }
    private func getAudio(_ track: Track) {
        guard signedIn else { return }
        guard server.reachable != false else { notify("Can't reach the server"); return }
        server.getAudio(track, settings: settings, library: library, player: player, playWhenReady: false)
    }
    private func playNext(_ track: Track) { player.playNext(track); queueTick += 1; notify("Plays next") }
    private func enqueue(_ track: Track) {
        let added = player.enqueue([track]) > 0
        if added { queueTick += 1 }; notify(added ? "Added to queue" : "Already in queue")
    }
    private func toggleQueued(_ track: Track) {
        guard player.current?.id != track.id else { return }
        if let index = player.queue.firstIndex(where: { $0.id == track.id }) {
            player.removeFromQueue(at: IndexSet(integer: index)); queueTick += 1; notify("Removed from queue")
        } else { enqueue(track) }
    }
    private func removeAudio(_ track: Track) { library.removeAudio(track.id); notify("Removed from this iPhone") }
    private func refresh() async {
        await server.syncCatalog(settings: settings, library: library)
        await listening.load(settings: settings, signedIn: signedIn)
    }
    private func notify(_ message: String) {
        dsWithAnimation { toast = message; toastID += 1 }
        UIAccessibility.post(notification: .announcement, argument: message)
    }
    private var offlineBanner: some View {
        HStack(spacing: DS.Space.space2) {
            Image(systemName: "wifi.slash").dsIcon(DS.Icon.iconInline).foregroundStyle(DS.Color.inkMuted)
            Text(server.syncing ? "Checking…" : "Offline. Your downloaded songs still play.").font(T.caption).foregroundStyle(DS.Color.ink)
            Spacer(minLength: 0)
            Button("Retry") { Task { await refresh() } }.font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit).disabled(server.syncing)
        }.padding(.horizontal, DS.Space.space3).librarySlab(radius: DS.Radius.radiusKey)
    }
    @ViewBuilder private var toastView: some View {
        if let toast {
            Text(toast).font(T.caption).foregroundStyle(DS.Color.ink).padding(DS.Space.space3).libraryFloat()
                .padding(.horizontal, DS.Space.space4)
                .transition(.opacity.combined(with: .offset(y: dsReduceMotion ? 0 : -DS.Motion.enterOffset)))
                .task(id: toastID) {
                    do { try await Task.sleep(for: .seconds(2)) } catch { return }
                    dsWithAnimation { self.toast = nil }
                }
        }
    }
    private func showPlaying(_ proxy: ScrollViewProxy) {
        guard let id = player.current?.id, songs.contains(where: { $0.id == id }) else { return }
        hideKeyboard()
        if tracks.contains(where: { $0.id == id }) { reveal(id, proxy: proxy) }
        else { showHiddenPlaying = true }
    }
    private func reveal(_ id: String, proxy: ScrollViewProxy) {
        proxy.scrollTo(id, anchor: .center)
        rowFocus = id
    }
    private func scrollTop(_ proxy: ScrollViewProxy) {
        proxy.scrollTo("library.top", anchor: .top)
    }
    private func scrolled(_ next: CGFloat) {
        let past = next < -DS.Space.space1
        if past != scrolledPast { scrolledPast = past }
    }
    private func hideKeyboard() { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
}

private struct LibraryScrollOffset: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
private struct LibraryChipEnd: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
