import SwiftUI

struct PlaybackView: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var library: LibraryStore
    @State private var showTags = false
    @State private var showQueue = false
    @State private var toast: String?
    @State private var editing: ServerSong?

    private var current: Track? { player.current }

    private func subtitle(_ t: Track) -> String {
        [t.artist, t.album, t.year.map(String.init)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
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
                              onShuffle: { player.shuffle.toggle() }, onPrevious: { player.previous() },
                              onToggle: { player.toggle() }, onNext: { player.next() },
                              onRepeat: { player.repeatMode = player.repeatMode == .off ? .all : player.repeatMode == .all ? .one : .off })
                upNextCard
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .dsGround()
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
    }

    private var menu: some View {
        Menu {
            Button { showQueue = true } label: { Label("Queue", systemImage: "list.bullet") }
            Button { showTags = true } label: { Label("Add songs by tag", systemImage: "tag") }
            if let t = current { Button { editing = ServerSong(t) } label: { Label("Song details", systemImage: "info.circle") } }
            Button { player.skip(by: -5) } label: { Label("Back 5 seconds", systemImage: "gobackward.5") }
            Button { player.skip(by: 5) } label: { Label("Forward 5 seconds", systemImage: "goforward.5") }
            Button(role: .destructive) { player.clearQueue() } label: { Label("Clear queue", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 20)).foregroundStyle(DS.Color.ink)
                .frame(width: DS.Space.hit, height: DS.Space.hit)
                .dsSlab(radius: DS.Radius.radiusPill)
        }
        .accessibilityLabel("More")
    }

    /// The song's cover, full width and square, with title and artist · album · year on a bottom gradient.
    private var cover: some View {
        Color.clear.frame(maxWidth: .infinity).frame(height: 300)
            .overlay { CoverImage(source: current?.thumbnail).accessibilityHidden(true) }
            .overlay(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(current?.title ?? "Nothing playing").font(T.title).lineLimit(3)
                    (Text(current.map(subtitle) ?? "Pick a song in Library.").foregroundStyle(DS.Color.surface.opacity(0.8))
                        + Text(current.map { " · " + sourceLabel($0.source) } ?? "").foregroundStyle(DS.Color.surface.opacity(0.6)))
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
            .accessibilityLabel(current.map { "\($0.title), \(subtitle($0)), \(sourceLabel($0.source))" } ?? "Nothing playing")
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
            ForEach(upNext) { t in
                HStack(spacing: DS.Space.space3) {
                    CoverImage(source: t.thumbnail).frame(width: 40, height: 40)
                        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(t.title).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink).lineLimit(1)
                        Text(t.artist).font(T.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Text("\u{22EE}\u{22EE}").font(.system(size: 16)).foregroundStyle(DS.Color.inkFaint).accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .dsSlab()
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
