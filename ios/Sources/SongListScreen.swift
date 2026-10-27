import SwiftUI

struct SongRoute: Hashable {
    let id: String
}

/// One row of a song list: a library song, or an album track that has no song yet.
struct SongListEntry: Identifiable, Hashable {
    enum Kind: Hashable {
        case song(Track)
        case missing(number: Int, title: String, duration: Double?)
    }

    let id: String
    let kind: Kind

    static func song(_ track: Track) -> SongListEntry { SongListEntry(id: track.id, kind: .song(track)) }

    static func missing(number: Int, title: String, duration: Double?) -> SongListEntry {
        SongListEntry(id: "missing-\(number)", kind: .missing(number: number, title: title, duration: duration))
    }

    var track: Track? {
        if case .song(let track) = kind { return track }
        return nil
    }
}

/// Extra row actions a list can offer; the shared screen shows the ones that are set.
struct SongListActions {
    var move: ((IndexSet, Int) -> Void)?
    var remove: ((Track) -> Void)?
    var addToPlaylist: ((Track) -> Void)?
}

enum SongListLogic {
    static func playable(_ entries: [SongListEntry], phoneIDs: Set<String>) -> [Track] {
        entries.compactMap(\.track).filter { phoneIDs.contains($0.id) }
    }
}

/// Transient message over a screen, the same look as the Library toast.
private struct ListToast: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let message {
                Text(message).font(T.caption).foregroundStyle(DS.Color.ink).padding(DS.Space.space3).libraryFloat()
                    .padding(.horizontal, DS.Space.space4)
                    .transition(.opacity.combined(with: .offset(y: dsReduceMotion ? 0 : -DS.Motion.enterOffset)))
                    .task(id: message) {
                        do { try await Task.sleep(for: .seconds(2)) } catch { return }
                        dsWithAnimation { self.message = nil }
                    }
            }
        }
        .onChange(of: message) { _, new in if let new { UIAccessibility.post(notification: .announcement, argument: new) } }
    }
}

extension View {
    func listToast(_ message: Binding<String?>) -> some View { modifier(ListToast(message: message)) }
}

/// The screen of one list of songs: a playlist or an album. Plays from the phone, shows what is not on it yet, and takes list-specific controls through `extra` and `menu`.
struct SongListScreen<Extra: View, MenuItems: View>: View {
    let title: String
    var lines: [String] = []
    var coverSource: String?
    let entries: [SongListEntry]
    var actions = SongListActions()
    var isEditing = false
    var onDone: (() -> Void)?
    var emptyText = "No songs here yet."
    var transfer: (String) -> (progress: Double, waiting: Bool)? = { _ in nil }
    var showsMenu = true
    @ViewBuilder var extra: () -> Extra
    @ViewBuilder var menu: () -> MenuItems

    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var player: PlayerService
    @EnvironmentObject private var server: ServerLink
    @EnvironmentObject private var settings: Settings
    @EnvironmentObject private var listening: ListeningStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var toast: String?
    @State private var detail: SongRoute?
    @State private var tick = 0

    private var signedIn: Bool { ServerLink.hasCredentials(settings) }
    private var playable: [Track] { SongListLogic.playable(entries, phoneIDs: library.phoneIDs) }

    var body: some View {
        Group {
            if isEditing, actions.move != nil { editList } else { readList }
        }
        .safeAreaInset(edge: .top, spacing: 0) { topBar }
        .dsGround().toolbar(.hidden, for: .navigationBar).background(LibraryBackSwipe())
        .listToast($toast)
        .sensoryFeedback(.success, trigger: tick)
        .navigationDestination(item: $detail) { route in
            SongDetailsView(id: route.id, play: { play($0) }, download: { download($0) }, notify: { toast = $0 },
                            deleted: { track in toast = "Deleted \"\(track.title)\"" })
        }
        .onChange(of: server.notice) { _, note in if let note { toast = note; server.notice = nil } }
    }

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: DS.Icon.iconNav)).foregroundStyle(DS.Color.ink)
                    .frame(width: DS.Space.hit, height: DS.Space.hit)
            }.accessibilityLabel("Back")
            Spacer()
            if isEditing, let onDone {
                Text(title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(1).accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Done", action: onDone).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
            } else if showsMenu {
                Menu { menu() } label: {
                    Image(systemName: "ellipsis").font(.system(size: DS.Icon.iconNav, weight: DS.Icon.iconWeight))
                        .foregroundStyle(DS.Color.ink).frame(width: DS.Space.hit, height: DS.Space.hit).contentShape(Rectangle())
                }.accessibilityLabel("Actions")
            }
        }.padding(.horizontal, DS.Space.space4).background(DS.Color.ground)
    }

    private var readList: some View {
        ScrollView {
            VStack(spacing: DS.Space.space4) {
                head
                transport
                extra()
                if entries.isEmpty {
                    Text(emptyText).font(T.body).foregroundStyle(DS.Color.inkMuted).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.vertical, DS.Space.space6)
                } else {
                    rows
                }
            }.padding(.horizontal, DS.Space.space4).padding(.bottom, DS.Space.space4)
        }
        .dockClearance()
        .refreshable { await refreshLibrary() }
    }

    private var head: some View {
        VStack(spacing: DS.Space.space3) {
            CoverImage(source: coverSource).frame(width: DS.Component.detailsCover, height: DS.Component.detailsCover)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).dsShadow(DS.Shadow.depthSlab).accessibilityHidden(true)
            VStack(spacing: DS.Space.space1) {
                Text(title).font(T.title).foregroundStyle(DS.Color.ink).lineLimit(3).accessibilityAddTraits(.isHeader)
                ForEach(lines, id: \.self) { Text($0).font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
            }.multilineTextAlignment(.center)
        }
    }

    private var transport: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: DS.Space.space2)) : AnyLayout(HStackLayout(spacing: DS.Space.space2))
        return layout {
            Button { playList(shuffled: false) } label: { Label("Play", systemImage: "play.fill") }
                .buttonStyle(LibraryPrimaryStyle()).disabled(playable.isEmpty)
            Button { playList(shuffled: true) } label: { Label("Shuffle", systemImage: "shuffle") }
                .buttonStyle(DSButtonStyle(kind: .outline)).disabled(playable.isEmpty)
            Button { addAllToQueue() } label: { Label("Queue", systemImage: "text.badge.plus") }
                .buttonStyle(DSButtonStyle(kind: .outline)).disabled(playable.isEmpty)
        }
    }

    private var rows: some View {
        let queued = Set(player.queue.map(\.id))
        return LazyVStack(spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                row(entry, queued: queued)
                if index < entries.count - 1 { LibraryHairline().padding(.horizontal, DS.Space.space3) }
            }
        }.clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).librarySlab()
    }

    @ViewBuilder private func row(_ entry: SongListEntry, queued: Set<String>) -> some View {
        switch entry.kind {
        case .song(let track): songRow(track, queued: queued.contains(track.id))
        case .missing(let number, let title, let duration): MissingTrackRow(number: number, title: title, duration: duration)
        }
    }

    private func songRow(_ track: Track, queued: Bool) -> some View {
        let onPhone = library.contains(track.id)
        let current = player.current?.id == track.id
        let extra = transfer(track.id)
        let tracked = server.transfers[track.id] != nil
        return LiveProgress(id: track.id, tracked: tracked, fallback: extra?.progress) { progress in
            LibrarySongRow(track: track, progress: progress, onPhone: onPhone, playing: current, isPlaying: player.isPlaying,
                           queued: queued, waiting: server.waiting.contains(track.id) || extra?.waiting == true,
                           offline: signedIn && server.reachable == false, retry: server.failed.contains(track.id),
                           listenedCount: signedIn && listening.loaded ? listening.entries[track.id]?.listened?.all ?? 0 : nil,
                           toggleQueue: onPhone && !current ? { toggleQueued(track) } : nil,
                           play: { play(track) }, details: { detail = SongRoute(id: track.id) }, download: { download(track) })
        }
            .contextMenu { menuItems(track, onPhone: onPhone, current: current, transferring: tracked || extra != nil) }
            .accessibilityActions {
                if onPhone && !current { Button(queued ? "Remove from queue" : "Add to queue") { toggleQueued(track) } }
                if let remove = actions.remove { Button("Remove from list") { remove(track) } }
            }
    }

    @ViewBuilder private func menuItems(_ track: Track, onPhone: Bool, current: Bool, transferring: Bool) -> some View {
        if onPhone && !current {
            Button { player.playNext(track); toast = "Plays next" } label: { Label("Play next", systemImage: "text.insert") }
            Button { toggleQueued(track) } label: { Label("Add to queue", systemImage: "text.badge.plus") }
        }
        if signedIn && !onPhone && !transferring && track.onServer != false {
            Button { download(track) } label: { Label("Download", systemImage: "arrow.down.circle") }
        }
        if let addToPlaylist = actions.addToPlaylist {
            Button { addToPlaylist(track) } label: { Label("Add to playlist", systemImage: "music.note.list") }
        }
        if let remove = actions.remove {
            Button(role: .destructive) { remove(track) } label: { Label("Remove from list", systemImage: "minus.circle") }
        }
    }

    private var editList: some View {
        List {
            Section {
                ForEach(entries) { entry in editRow(entry) }
                    .onMove { actions.move?($0, $1) }
                    .onDelete { offsets in
                        for index in offsets { if let track = entries[index].track { actions.remove?(track) } }
                    }
            } header: { Text("Drag to reorder, swipe to remove").font(T.caption).foregroundStyle(DS.Color.inkMuted) }
        }
        .listStyle(.plain).scrollContentBackground(.hidden).dockClearance()
        .environment(\.editMode, .constant(.active))
    }

    private func editRow(_ entry: SongListEntry) -> some View {
        HStack(spacing: DS.Space.space3) {
            CoverImage(source: entry.track?.thumbnail).frame(width: DS.Component.coverRow, height: DS.Component.coverRow)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: DS.Space.space1) {
                Text(entry.track?.title ?? "").font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                Text(entry.track?.librarySubtitle ?? "").font(T.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
        }.listRowBackground(DS.Color.surface)
    }

    private func play(_ track: Track) {
        if library.contains(track.id) {
            if player.current?.id == track.id { player.toggle(); return }
            let phone = playable
            guard let index = phone.firstIndex(where: { $0.id == track.id }) else { return }
            player.play(phone, startAt: index)
        } else if server.transfers[track.id] != nil || transfer(track.id) != nil {
            toast = "Already downloading"
        } else if track.onServer == false {
            toast = "No audio yet"
        } else {
            download(track)
        }
    }

    private func download(_ track: Track) {
        guard signedIn else { return }
        guard server.reachable != false else { toast = "Can't reach the server"; return }
        Task { _ = await server.download(track, settings: settings, into: library) }
    }

    private func playList(shuffled: Bool) {
        let list = playable
        guard !list.isEmpty else { toast = "No songs on this iPhone"; return }
        let wasOn = player.shuffle
        if player.shuffle != shuffled { player.shuffle = shuffled }
        player.playAll(list)
        tick += 1
        let missing = entries.compactMap(\.track).count - list.count
        toast = PlaylistLogic.playNote(count: list.count, notOnPhone: missing, shuffled: shuffled, shuffleWasOn: wasOn)
    }

    private func addAllToQueue() {
        let list = playable
        guard !list.isEmpty else { toast = "No songs on this iPhone"; return }
        let added = player.enqueue(list)
        if added > 0 { tick += 1 }
        let missing = entries.compactMap(\.track).count - list.count
        toast = PlaylistLogic.queueNote(added: added, already: list.count - added, notOnPhone: missing)
    }

    private func toggleQueued(_ track: Track) {
        guard player.current?.id != track.id else { return }
        if let index = player.queue.firstIndex(where: { $0.id == track.id }) {
            player.removeFromQueue(at: IndexSet(integer: index))
            toast = "Removed from queue"
        } else {
            let added = player.enqueue([track]) > 0
            if added { tick += 1 }
            toast = added ? "Added to queue" : "Already in queue"
        }
    }

    private func refreshLibrary() async {
        await server.syncCatalog(settings: settings, library: library)
    }
}

/// An album track with no song yet: muted, with its number, title and length.
struct MissingTrackRow: View {
    let number: Int
    let title: String
    let duration: Double?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: DS.Space.space3) {
            Text(String(number)).font(T.subhead).monospacedDigit().foregroundStyle(DS.Color.inkFaint)
                .frame(width: DS.Component.coverRow, alignment: .center)
            VStack(alignment: .leading, spacing: DS.Space.space1) {
                Text(title).font(T.headline).foregroundStyle(DS.Color.inkMuted).lineLimit(typeSize.isAccessibilitySize ? 3 : 2)
                Text("Not in your library").font(T.caption).foregroundStyle(DS.Color.inkFaint)
            }
            Spacer(minLength: 0)
            if let duration, duration > 0 { Text(formatTime(duration)).font(T.time).foregroundStyle(DS.Color.inkFaint).fixedSize() }
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space3)
        .frame(maxWidth: .infinity, minHeight: DS.Component.coverRow + DS.Space.space3 * 2, alignment: .leading)
        .background(DS.Color.surface)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Track \(number), \(title), not in your library" + (duration.map { ", \(formatTime($0))" } ?? ""))
    }
}
