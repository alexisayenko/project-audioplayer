import SwiftUI

struct PlaybackView: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var library: LibraryStore
    @ScaledMetric(relativeTo: .body) private var menuIcon: CGFloat = 20
    @ScaledMetric(relativeTo: .body) private var menuHit: CGFloat = DS.Space.hit
    @State private var showTags = false
    @State private var shuffleTaps = 0
    @State private var repeatTaps = 0
    @State private var toggleTaps = 0
    @State private var showQueue = false
    @State private var showShare = false
    @State private var toast: String?
    @State private var confirmClear = false
    @State private var editing: ServerSong?
    @State private var playlistSongs: [String] = []
    @EnvironmentObject private var settings: Settings
    @Environment(\.colorSchemeContrast) private var contrast

    private var signedIn: Bool { ServerLink.hasCredentials(settings) }
    private var current: Track? { player.current }
    private var menuSize: CGFloat { min(max(menuHit, DS.Space.hit), DS.Space.hit * 1.5) }

    private func subtitle(_ t: Track) -> String {
        [t.artist, t.year.map(String.init), sourceLabel(t.source)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var upNext: [Track] {
        guard let i = player.index, i + 1 < player.queue.count else { return [] }
        return Array(player.queue[(i + 1)...].prefix(2))
    }

    private var hasMoreUpNext: Bool {
        guard let i = player.index else { return false }
        return player.queue.count > i + 1 + upNext.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                ScreenHeader(title: "Now playing", align: .top) { menu }
                cover
                genreChips
                progress
                TransportTray(playing: player.isPlaying, shuffle: player.shuffle, repeatMode: player.repeatMode,
                              onShuffle: { shuffleTaps += 1; player.shuffle.toggle() }, onPrevious: { player.previous() },
                              onToggle: { toggleTaps += 1; player.toggle() }, onNext: { player.next() },
                              onRepeat: { repeatTaps += 1; player.repeatMode = player.repeatMode.next })
                    .disabled(current == nil)
                upNextCard
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .dsGround()
        .sensoryFeedback(.selection, trigger: shuffleTaps)
        .sensoryFeedback(.selection, trigger: repeatTaps)
        .sensoryFeedback(.impact, trigger: toggleTaps)
        .overlay(alignment: .top) {
            if let toast {
                Text(toast).font(T.caption).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
                    .dsSlab(radius: DS.Radius.radiusPill)
                    .task(id: toast) { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
            }
        }
        .sheet(isPresented: $showTags) {
            TagPickerSheet(tracks: library.tracks) { picks in
                let n = player.addTagged(picks, from: library.tracks)
                toast = n == 0 ? "No new songs for these tags" : "Added \(n) \(n == 1 ? "song" : "songs")"
            }
        }
        .confirmationDialog("Clear the queue?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear queue", role: .destructive) { player.clearQueue() }
        } message: { Text("Removes the up-next songs. The current song keeps playing.") }
        .sheet(isPresented: $showQueue) { QueueSheet() }
        .sheet(item: $editing) { SongEditView(song: $0) }
        .sheet(isPresented: Binding(get: { !playlistSongs.isEmpty }, set: { if !$0 { playlistSongs = [] } })) {
            PlaylistPickerSheet(songIDs: playlistSongs) { toast = $0 }
        }
        .sheet(isPresented: $showShare) {
            if let t = current { ShareSheet(track: t, position: player.position, duration: player.duration) }
        }
    }

    private var menu: some View {
        Menu {
            Button { showQueue = true } label: { Label("Queue", systemImage: "list.bullet") }
            Button { showTags = true } label: { Label("Add songs by tag", systemImage: "tag") }
            if let t = current { Button { editing = ServerSong(t) } label: { Label("Song details", systemImage: "info.circle") } }
            if signedIn, let t = current, t.localOnly != true {
                Button { playlistSongs = [t.id] } label: { Label("Add to playlist", systemImage: "music.note.list") }
            }
            if signedIn, !player.queue.isEmpty {
                Button { playlistSongs = player.queue.map(\.id) } label: { Label("Save queue as playlist", systemImage: "text.badge.plus") }
            }
            Button { showShare = true } label: { Label("Share link", systemImage: "square.and.arrow.up") }
                .disabled(current.map { !SongShare.isValidID($0.id) } ?? true)
            Button { player.skip(by: -5) } label: { Label("Back 5 seconds", systemImage: "gobackward.5") }
            Button { player.skip(by: 5) } label: { Label("Forward 5 seconds", systemImage: "goforward.5") }
            Button(role: .destructive) { confirmClear = true } label: { Label("Clear queue", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: min(menuIcon, menuSize / 2))).foregroundStyle(DS.Color.ink)
                .frame(width: menuSize, height: menuSize)
                .dsSlab(radius: DS.Radius.radiusPill)
        }
        .accessibilityLabel("More")
    }

    /// The song's cover, full width and square, with title and artist · album · year on a bottom gradient.
    private var cover: some View {
        Color.clear.frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit).frame(maxHeight: 520)
            .overlay { CoverImage(source: current?.thumbnail).accessibilityHidden(true) }
            .overlay(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(current?.title ?? "Nothing playing").font(T.title).lineLimit(3)
                    Text(current.map(subtitle) ?? "Pick a song in Library.").foregroundStyle(DS.Color.surface.opacity(0.8))
                        .font(T.body).lineLimit(2)
                }
                .foregroundStyle(DS.Color.surface)
                .environment(\.colorScheme, .light)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, DS.Space.space4).padding(.bottom, 14).padding(.top, 56)
                .background(LinearGradient(stops: [.init(color: DS.Color.vinyl.opacity(0), location: 0),
                                                   .init(color: DS.Color.vinyl.opacity(0.65), location: 0.4),
                                                   .init(color: DS.Color.vinyl.opacity(0.9), location: 1)],
                                           startPoint: .top, endPoint: .bottom))
            }
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous))
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(current.map { "\($0.title), \(subtitle($0))" } ?? "Nothing playing")
    }

    private var progress: some View {
        PlaybackProgress(hasSong: current != nil)
    }

    private var currentGenres: [String] {
        guard let current else { return [] }
        return LibraryFacet.genres.keys(current)
            .filter { $0 != LibraryFacet.genres.unknown }
            .map { LibraryFacet.genres.label($0) }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    @ViewBuilder
    private var genreChips: some View {
        if !currentGenres.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: DS.Space.space2) {
                    ForEach(currentGenres, id: \.self) { genre in
                        Text(genre)
                            .font(T.subhead.weight(.medium))
                            .foregroundStyle(DS.Color.ink)
                            .padding(.horizontal, DS.Space.space3)
                            .frame(minHeight: DS.Control.control)
                            .background(Capsule().fill(DS.Color.surface).dsShadow(DS.Shadow.depthSlab))
                            .overlay(Capsule().strokeBorder(contrast.outline, lineWidth: DS.Stroke.strokeThin))
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Genres: \(currentGenres.joined(separator: ", "))")
        }
    }

    private func upNextRow(_ t: Track) -> some View {
        return HStack(spacing: DS.Space.space3) {
            CoverImage(source: t.thumbnail).frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(t.title).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink).lineLimit(1)
                Text(t.artist).font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: DS.Space.hit)
        .accessibilityElement(children: .combine)
    }

    private var upNextCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Up next").font(T.headline).foregroundStyle(DS.Color.ink)
                Spacer()
                Button { showQueue = true } label: {
                    Text("Queue (\(player.queue.count))").font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .frame(minHeight: 22)
                        .contentShape(Rectangle().inset(by: -11))
                }
            }
            if upNext.isEmpty {
                Text(player.queue.isEmpty ? "Queue is empty. Add songs from Library." : "Nothing after this song.")
                    .font(T.subhead).foregroundStyle(DS.Color.inkMuted)
            }
            ForEach(Array(upNext.enumerated()), id: \.element.id) { i, t in
                SwipeToRemoveQueueRow {
                    upNextRow(t)
                } onRemove: {
                    guard let base = player.index.map({ $0 + 1 }) else { return }
                    dsWithAnimation {
                        player.removeFromQueue(at: IndexSet(integer: base + i))
                    }
                }
                .overlay(alignment: .bottom) {
                    if hasMoreUpNext && i == upNext.count - 1 {
                        LinearGradient(colors: [.clear, DS.Color.surface.opacity(0.88)], startPoint: .top, endPoint: .bottom)
                            .frame(height: 20)
                            .allowsHitTesting(false)
                    }
                }
            }
            if player.shuffle && upNext.count > 1 {
                Text("Shuffle is on, so songs play in random order.").font(T.caption).foregroundStyle(DS.Color.inkMuted)
            }
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .dsSlab()
    }
}

private struct SwipeToRemoveQueueRow<Content: View>: View {
    @State private var offset: CGFloat = 0
    @State private var translation: CGFloat = 0
    let content: Content
    let onRemove: () -> Void

    init(@ViewBuilder content: () -> Content, onRemove: @escaping () -> Void) {
        self.content = content()
        self.onRemove = onRemove
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            Label("Remove", systemImage: "trash")
                .font(T.caption.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 76)
                .frame(maxHeight: .infinity)
                .background(.red)
                .opacity(offset < -12 || translation < -12 ? 1 : 0)
            content
                .offset(x: min(0, max(-76, offset + translation)))
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        translation = value.translation.width
                    }
                    .onEnded { value in
                        guard abs(value.translation.width) > abs(value.translation.height) else { translation = 0; return }
                        let distance = offset + value.translation.width
                        translation = 0
                        if distance < -104 {
                            dsWithAnimation { onRemove() }
                        } else {
                            dsWithAnimation { offset = distance < -34 ? -76 : 0 }
                        }
                    })
        }
        .clipped()
        .accessibilityAction(named: "Remove from queue") { onRemove() }
    }
}

/// The whole queue: jump to a song, swipe to remove, clear.
private struct QueueSheet: View {
    @EnvironmentObject var player: PlayerService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if player.queue.isEmpty {
                    Text("Queue is empty. Add songs from Library.").font(T.body).foregroundStyle(DS.Color.inkMuted)
                        .listRowBackground(Color.clear)
                }
                if !player.queueTags.isEmpty {
                    FlowLayout {
                        ForEach(player.queueTags, id: \.self) { t in
                            TagChip(text: tagLabel(t), on: true, removable: true) { player.removeQueueTag(t) }
                        }
                    }
                    .listRowBackground(Color.clear)
                }
                ForEach(Array(player.queue.enumerated()), id: \.element.id) { i, track in
                    HStack(spacing: DS.Space.space2) {
                        Button { player.jump(to: i) } label: {
                            SongRow(title: track.title, subtitle: track.artist, source: track.source, thumbnail: track.thumbnail, duration: track.duration,
                                    playing: i == player.index, coverSize: 48)
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity)
                        Image(systemName: "line.3.horizontal")
                            .font(T.subhead.weight(.semibold))
                            .foregroundStyle(DS.Color.inkMuted)
                            .frame(width: DS.Space.hit, height: DS.Space.hit)
                            .contentShape(Rectangle())
                            .draggable(track.id)
                            .accessibilityLabel("Reorder \(track.title)")
                    }
                    .listRowInsets(EdgeInsets()).listRowBackground(i == player.index ? DS.Color.accentTint : DS.Color.surface)
                    .listRowSeparatorTint(DS.Color.line)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) { player.removeFromQueue(at: IndexSet(integer: i)) } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
                    .dropDestination(for: String.self) { ids, _ in
                        guard let id = ids.first,
                              let from = player.queue.firstIndex(where: { $0.id == id }), from != i else { return false }
                        player.moveQueueItem(from: IndexSet(integer: from), to: i)
                        return true
                    }
                }
            }
            .listStyle(.plain).scrollContentBackground(.hidden).dsGround()
            .navigationTitle("Queue").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") { player.clearQueue() }.foregroundStyle(DS.Color.accentInk).disabled(player.queue.isEmpty)
                }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.foregroundStyle(DS.Color.accentInk) }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Pick tags from the songs on the phone and add every matching song to the queue.
private struct TagPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var picks: [String] = []
    let tracks: [Track]
    let onAdd: ([String]) -> Void

    private var groups: [TagGroup] { tagGroups(tagCounts(tracks.map { $0.tags ?? [] })) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space3) {
                    if groups.isEmpty { Text("No tags on the phone yet.").font(T.body).foregroundStyle(DS.Color.inkMuted) }
                    ForEach(groups) { g in
                        SectionLabel(g.name)
                        FlowLayout {
                            ForEach(g.tags, id: \.tag) { t in
                                let on = picks.contains { $0.lowercased() == t.tag.lowercased() }
                                TagChip(text: tagLabel(t.tag), count: t.count, on: on) {
                                    if on { picks.removeAll { $0.lowercased() == t.tag.lowercased() } } else { picks.append(t.tag) }
                                }
                            }
                        }
                    }
                }
                .padding(DS.Space.space4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .dsGround()
            .navigationTitle("Add songs by tag").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(DS.Color.accentInk) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { onAdd(picks); dismiss() }.foregroundStyle(DS.Color.accentInk).disabled(picks.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct PlaybackProgress: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var clock: PlaybackClock
    let hasSong: Bool

    var body: some View {
        VStack(spacing: 6) {
            DSSlider(value: Binding(get: { clock.position }, set: { player.seek(to: $0) }),
                     range: 0...max(clock.duration, 1), label: "Position", disabled: !hasSong || clock.duration <= 0,
                     tapStep: 5) { formatTime($0) }
                .padding(.vertical, -19)
            HStack {
                Text(formatTime(clock.position))
                Spacer()
                Text("-" + formatTime(max(clock.duration - clock.position, 0)))
            }
            .font(T.time).foregroundStyle(DS.Color.inkMuted).accessibilityHidden(true)
        }
    }
}
