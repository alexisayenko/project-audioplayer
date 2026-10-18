import SwiftUI

struct PlaybackView: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var library: LibraryStore
    @ScaledMetric(relativeTo: .body) private var menuIcon: CGFloat = 20
    @ScaledMetric(relativeTo: .body) private var menuHit: CGFloat = DS.Space.hit
    @ScaledMetric(relativeTo: .body) private var grip: CGFloat = 16
    @State private var showTags = false
    @State private var shuffleTaps = 0
    @State private var repeatTaps = 0
    @State private var toggleTaps = 0
    @State private var showQueue = false
    @State private var showShare = false
    @State private var toast: String?
    @State private var editing: ServerSong?
    @GestureState private var drag: (id: String, dy: CGFloat)?
    @State private var rowHeight: CGFloat = 40
    @State private var hapticSlot: Int?
    @State private var liftTick = 0
    @State private var slotTick = 0
    @State private var reorderTick = 0

    private var current: Track? { player.current }
    private var menuSize: CGFloat { min(max(menuHit, DS.Space.hit), DS.Space.hit * 1.5) }

    private func subtitle(_ t: Track) -> String {
        [t.artist, t.year.map(String.init), sourceLabel(t.source)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var upNext: [Track] {
        guard let i = player.index, i + 1 < player.queue.count else { return [] }
        return Array(player.queue[(i + 1)...].prefix(2))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                ScreenHeader(title: "Now playing", align: .top) { menu.padding(.top, DS.Space.space2) }
                cover
                progress
                TransportTray(playing: player.isPlaying, shuffle: player.shuffle, repeatMode: player.repeatMode,
                              onShuffle: { shuffleTaps += 1; player.shuffle.toggle() }, onPrevious: { player.previous() },
                              onToggle: { toggleTaps += 1; player.toggle() }, onNext: { player.next() },
                              onRepeat: { repeatTaps += 1; player.repeatMode = player.repeatMode.next })
                upNextCard
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .dsGround()
        .sensoryFeedback(.selection, trigger: shuffleTaps)
        .sensoryFeedback(.selection, trigger: repeatTaps)
        .sensoryFeedback(.impact, trigger: toggleTaps)
        .sensoryFeedback(.impact(weight: .light), trigger: liftTick)
        .sensoryFeedback(.selection, trigger: slotTick)
        .sensoryFeedback(.success, trigger: reorderTick)
        .overlay(alignment: .top) {
            if let toast {
                Text(toast).font(T.caption).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
                    .dsSlab(radius: DS.Radius.radiusPill)
                    .task(id: toast) { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
            }
        }
        .sheet(isPresented: $showTags) {
            TagPickerSheet { picks in
                let n = player.addTagged(picks, from: library.tracks)
                toast = n == 0 ? "No new songs for these tags" : "Added \(n) \(n == 1 ? "song" : "songs")"
            }
        }
        .sheet(isPresented: $showQueue) { QueueSheet() }
        .sheet(item: $editing) { SongEditView(song: $0) }
        .sheet(isPresented: $showShare) {
            if let t = current { ShareSheet(track: t, position: player.position, duration: player.duration) }
        }
    }

    private var menu: some View {
        Menu {
            Button { showQueue = true } label: { Label("Queue", systemImage: "list.bullet") }
            Button { showTags = true } label: { Label("Add songs by tag", systemImage: "tag") }
            if let t = current { Button { editing = ServerSong(t) } label: { Label("Song details", systemImage: "info.circle") } }
            Button { showShare = true } label: { Label("Share link", systemImage: "square.and.arrow.up") }
                .disabled(current.map { !SongShare.isValidID($0.id) } ?? true)
            Button { player.skip(by: -5) } label: { Label("Back 5 seconds", systemImage: "gobackward.5") }
            Button { player.skip(by: 5) } label: { Label("Forward 5 seconds", systemImage: "goforward.5") }
            Button(role: .destructive) { player.clearQueue() } label: { Label("Clear queue", systemImage: "trash") }
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
        VStack(spacing: 6) {
            DSSlider(value: Binding(get: { player.position }, set: { player.seek(to: $0) }),
                     range: 0...max(player.duration, 1), label: "Position", disabled: current == nil) { formatTime($0) }
                .padding(.vertical, -19)
            HStack {
                Text(formatTime(player.position))
                Spacer()
                Text("-" + formatTime(max(player.duration - player.position, 0)))
            }
            .font(T.time).foregroundStyle(DS.Color.inkMuted).accessibilityHidden(true)
        }
    }

    private var rowStep: CGFloat { rowHeight + 10 }

    private func slot(of id: String, dy: CGFloat) -> Int? {
        guard let i = upNext.firstIndex(where: { $0.id == id }) else { return nil }
        return min(max(i + Int((dy / rowStep).rounded()), 0), upNext.count - 1)
    }

    private func move(_ id: String, by delta: Int) {
        guard delta != 0, let base = player.index.map({ $0 + 1 }),
              let i = upNext.firstIndex(where: { $0.id == id }), upNext.indices.contains(i + delta) else { return }
        let from = base + i
        player.moveQueueItem(from: IndexSet(integer: from), to: delta > 0 ? from + delta + 1 : from + delta)
        reorderTick += 1
    }

    private func upNextRow(_ i: Int, _ t: Track) -> some View {
        let id = t.id
        let lifted = drag?.id == id
        let dy = lifted ? min(max(drag?.dy ?? 0, -CGFloat(i) * rowStep), CGFloat(upNext.count - 1 - i) * rowStep) : 0
        let reorderable = upNext.count > 1 && !player.shuffle
        return HStack(spacing: DS.Space.space3) {
            CoverImage(source: t.thumbnail).frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(t.title).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink).lineLimit(1)
                Text(t.artist).font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
            }
            Spacer(minLength: 0)
            if reorderable {
                Text("\u{22EE}\u{22EE}").font(.system(size: grip)).foregroundStyle(lifted ? DS.Color.accentInk : DS.Color.inkFaint)
                    .frame(width: 44).frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 2, coordinateSpace: .global)
                        .updating($drag) { v, state, _ in state = (id, v.translation.height) }
                        .onChanged { v in
                            guard let s = slot(of: id, dy: v.translation.height) else { return }
                            if hapticSlot == nil { liftTick += 1 }
                            if s != hapticSlot { hapticSlot = s; slotTick += 1 }
                        }
                        .onEnded { v in
                            hapticSlot = nil
                            if let s = slot(of: id, dy: v.translation.height), let i = upNext.firstIndex(where: { $0.id == id }) {
                                move(id, by: s - i)
                            }
                        })
                    .accessibilityHidden(true)
            }
        }
        .background(GeometryReader { g in
            Color.clear.onChange(of: g.size.height, initial: true) { _, h in if drag == nil { rowHeight = h } }
        })
        .background(lifted ? DS.Color.accentTint : Color.clear)
        .offset(y: dy)
        .shadow(color: DS.Color.vinyl.opacity(lifted ? 0.2 : 0), radius: 6, y: 2)
        .zIndex(lifted ? 1 : 0)
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "Move up") { if reorderable { move(id, by: -1) } }
        .accessibilityAction(named: "Move down") { if reorderable { move(id, by: 1) } }
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
            ForEach(Array(upNext.enumerated()), id: \.element.id) { i, t in upNextRow(i, t) }
            if player.shuffle && upNext.count > 1 {
                Text("Shuffle is on, so songs play in random order.").font(T.caption).foregroundStyle(DS.Color.inkMuted)
            }
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .dsSlab()
        .onChange(of: drag == nil) { _, idle in if idle { hapticSlot = nil } }
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
                    Button { player.jump(to: i) } label: {
                        SongRow(title: track.title, subtitle: track.artist, source: track.source, thumbnail: track.thumbnail, duration: track.duration,
                                playing: i == player.index, coverSize: 48)
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets()).listRowBackground(i == player.index ? DS.Color.accentTint : DS.Color.surface)
                    .listRowSeparatorTint(DS.Color.line)
                }
                .onDelete { player.removeFromQueue(at: $0) }
                .onMove { player.moveQueueItem(from: $0, to: $1) }
            }
            .listStyle(.plain).scrollContentBackground(.hidden).dsGround()
            .navigationTitle("Queue").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") { player.clearQueue() }.foregroundStyle(DS.Color.accentInk).disabled(player.queue.isEmpty)
                }
                ToolbarItem(placement: .principal) {
                    EditButton().foregroundStyle(DS.Color.accentInk).disabled(player.queue.count < 2)
                }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.foregroundStyle(DS.Color.accentInk) }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Pick tags from the songs on the phone and add every matching song to the queue.
private struct TagPickerSheet: View {
    @EnvironmentObject var library: LibraryStore
    @Environment(\.dismiss) private var dismiss
    @State private var picks: [String] = []
    let onAdd: ([String]) -> Void

    private var groups: [TagGroup] { tagGroups(tagCounts(library.tracks.map { $0.tags ?? [] })) }

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
