import SwiftUI

struct PlaybackPage: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var library: LibraryStore
    @ObservedObject private var mac = MacPlayback.shared
    @State private var picking = false

    var body: some View {
        GeometryReader { g in
            let wide = g.size.width >= 900
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space5) {
                    header
                    if wide {
                        HStack(alignment: .top, spacing: DS.Space.space6) {
                            NowPlayingColumn().frame(width: 420)
                            QueueCard(scrolls: true, maxHeight: g.size.height * 0.78, picking: $picking)
                        }
                    } else {
                        NowPlayingColumn().frame(maxWidth: 420, alignment: .leading)
                        QueueCard(scrolls: false, maxHeight: nil, picking: $picking)
                    }
                }
                .padding(.horizontal, DS.Space.space6).padding(.top, DS.Space.space6).padding(.bottom, DS.Space.space4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(DS.Color.ground)
        .navigationTitle(player.current.map(SongName.displayLine) ?? "Now playing")
        .sheet(isPresented: $picking) { TagPickerSheet() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            Text("ELECTROPHONE").font(DS.Font.eyebrow).tracking(DS.Font.eyebrowTracking).foregroundStyle(DS.Color.accentInk)
            Text("Now playing").font(DS.Font.display).foregroundStyle(DS.Color.ink)
        }
        .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
    }
}

private func playable(_ t: Track) -> Bool { t.onServer != false || FileManager.default.fileExists(atPath: t.fileURL.path) }

private struct NowPlayingColumn: View {
    @EnvironmentObject var player: PlayerService
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space4) {
            cover
            if let t = player.current {
                actions(t)
                if !playable(t) {
                    Text("Not downloaded").font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted)
                } else if player.failedTrackID == t.id {
                    Text("Cannot play this song").font(DS.Font.subhead).foregroundStyle(DS.Color.powerText)
                }
                details(t)
            }
        }
    }

    @ViewBuilder private var cover: some View {
        let t = player.current
        let label = t.map { "\(player.isPlaying ? "Pause" : "Play") \(SongName.displayLine($0))" } ?? "Nothing playing"
        Button { player.toggle() } label: {
            PlaybackCover(source: t?.thumbnail)
                .overlay(alignment: .bottomLeading) {
                    if let t {
                        VStack(alignment: .leading, spacing: 2) {
                            SongName.title(t).font(DS.Font.title).foregroundStyle(.white).lineLimit(2)
                            Text(SongName.subtitle(t)).font(DS.Font.subhead).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
                        }
                        .shadow(color: .black.opacity(0.5), radius: 2)
                        .padding(DS.Space.space4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(LinearGradient(colors: [.clear, DS.Color.vinyl.opacity(0.85)], startPoint: .top, endPoint: .bottom))
                        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: DS.Radius.radiusCard, bottomTrailingRadius: DS.Radius.radiusCard))
                    } else {
                        Text("Nothing playing").font(DS.Font.headline).foregroundStyle(DS.Color.chrome)
                    }
                }
                .overlay {
                    if t != nil {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 64, height: 64)
                            .background(Circle().fill(DS.Color.vinyl.opacity(0.55)))
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(t == nil)
        .accessibilityLabel(label)
    }

    private func actions(_ t: Track) -> some View {
        HStack(spacing: DS.Space.space2) {
            Spacer(minLength: 0)
            if let url = sourceLink(t) {
                Button { openURL(url) } label: { Image(systemName: t.source == "soundcloud" ? "cloud.fill" : "play.rectangle.fill") }
                    .buttonStyle(RoundIconButtonStyle())
                    .help("Open on \(sourceLabel(t.source))").accessibilityLabel("Open on \(sourceLabel(t.source))")
            }
            if let (url, label) = wikipedia(t) {
                Button { openURL(url) } label: { Text("W").font(.system(size: 16, weight: .bold, design: .serif)) }
                    .buttonStyle(RoundIconButtonStyle()).help(label).accessibilityLabel(label)
            }
        }
    }

    private func sourceLink(_ t: Track) -> URL? {
        let raw = t.sourceURL ?? t.sources?.compactMap(\.url).first
        guard let raw, let u = URL(string: raw), u.scheme == "https" || u.scheme == "http" else { return nil }
        return u
    }

    private func wikipedia(_ t: Track) -> (URL, String)? {
        let pairs: [(String?, String)] = [(t.wikipediaSong, "Song on Wikipedia"), (t.wikipediaArtist, "Artist on Wikipedia")]
        for (link, label) in pairs {
            if let link, let u = URL(string: link), u.scheme == "https" { return (u, label) }
        }
        return nil
    }

    @ViewBuilder private func details(_ t: Track) -> some View {
        let tags = (t.tags ?? []).filter { tagKey($0) != "lang" }
        if !tags.isEmpty || t.bpm != nil {
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                PlaybackFlow {
                    ForEach(tags, id: \.self) { tag in
                        Text(tagLabel(tag)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
                            .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space1)
                            .background(Capsule().fill(DS.Color.surfaceSunken))
                    }
                }
                if let bpm = t.bpm {
                    Text("\(Int(bpm.rounded())) BPM").font(DS.Font.time).foregroundStyle(DS.Color.inkMuted)
                }
            }
        }
    }
}

private struct QueueCard: View {
    let scrolls: Bool
    let maxHeight: CGFloat?
    @Binding var picking: Bool
    @EnvironmentObject var player: PlayerService
    @ObservedObject private var mac = MacPlayback.shared

    private var upcoming: Int { player.index.map { max(player.queue.count - $0 - 1, 0) } ?? 0 }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            head.padding(DS.Space.space4)
            if !player.queueTags.isEmpty {
                PlaybackFlow {
                    ForEach(player.queueTags, id: \.self) { tag in
                        HStack(spacing: DS.Space.space1) {
                            Text(tagLabel(tag)).font(DS.Font.caption)
                            Button { removeTag(tag) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }
                                .buttonStyle(.plain).accessibilityLabel("Remove \(tagLabel(tag))")
                        }
                        .foregroundStyle(DS.Color.accentInk)
                        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space1)
                        .background(Capsule().fill(DS.Color.accentTint))
                    }
                }
                .padding(.horizontal, DS.Space.space4).padding(.bottom, DS.Space.space3)
            }
            Divider().overlay(DS.Color.line)
            if player.queue.isEmpty {
                Text("Queue is empty - add songs from Library")
                    .font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted).padding(DS.Space.space4)
            } else if scrolls {
                ScrollView { rows }.frame(maxHeight: maxHeight)
            } else {
                rows
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(DS.Color.surface))
        .overlay(shape.strokeBorder(DS.Color.line, lineWidth: DS.Stroke.strokeHairline))
        .clipShape(shape)
    }

    private var head: some View {
        HStack(spacing: DS.Space.space3) {
            Text("Queue").font(DS.Font.title).foregroundStyle(DS.Color.ink)
            if !player.queue.isEmpty {
                Text("\(player.queue.count) song\(player.queue.count == 1 ? "" : "s")")
                    .font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            }
            Spacer()
            Button("Add by tag") { picking = true }
                .buttonStyle(.plain).font(DS.Font.subheadStrong).foregroundStyle(DS.Color.accentInk)
            Button("Clear", action: clear)
                .buttonStyle(.plain).font(DS.Font.subheadStrong).foregroundStyle(DS.Color.accentInk)
                .disabled(upcoming == 0 && player.queueTags.isEmpty)
                .help(upcoming == 0 && player.queueTags.isEmpty ? "Nothing upcoming to clear" : "Remove every song after the current one")
        }
    }

    private var rows: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(player.queue.enumerated()), id: \.element.id) { i, track in
                QueueRow(position: i + 1, track: track, current: i == player.index, first: i == 0, last: i == player.queue.count - 1,
                         remove: { remove(track) }, up: { player.moveInQueue(from: i, to: i - 1) }, down: { player.moveInQueue(from: i, to: i + 1) })
            }
        }
    }

    private func clear() {
        let tags = player.queueTags
        let before = player.queue.count
        for t in tags { player.removeQueueTag(t) }
        if let i = player.index, i + 1 < player.queue.count { player.removeFromQueue(at: IndexSet((i + 1)..<player.queue.count)) }
        let n = before - player.queue.count
        mac.show(n > 0 ? "Cleared \(n) song\(n == 1 ? "" : "s")" : "Tag chips cleared")
    }

    private func removeTag(_ tag: String) {
        let before = player.queue.count
        player.removeQueueTag(tag)
        let n = before - player.queue.count
        mac.show(n > 0 ? "Removed \(n) song\(n == 1 ? "" : "s")" : "Tag removed")
    }

    private func remove(_ track: Track) {
        guard let at = player.queue.firstIndex(where: { $0.id == track.id }) else { return }
        if at == player.index, player.isPlaying, player.hasNext { player.next() }
        if let now = player.queue.firstIndex(where: { $0.id == track.id }) { player.removeFromQueue(at: IndexSet(integer: now)) }
    }
}

private struct QueueRow: View {
    let position: Int
    let track: Track
    let current: Bool
    let first: Bool
    let last: Bool
    let remove: () -> Void
    let up: () -> Void
    let down: () -> Void
    @EnvironmentObject var player: PlayerService
    @State private var hover = false

    var body: some View {
        let ready = playable(track)
        HStack(spacing: DS.Space.space3) {
            Text("\(position)").font(DS.Font.time).foregroundStyle(DS.Color.inkMuted).frame(width: 28, alignment: .trailing)
            Button(action: activate) {
                PlaybackCover(source: track.thumbnail, radius: DS.Radius.radiusSm).frame(width: 60, height: 60)
                    .overlay {
                        if current || hover {
                            Image(systemName: current && player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                .frame(width: 32, height: 32).background(Circle().fill(DS.Color.vinyl.opacity(0.6)))
                        }
                    }
                    .opacity(ready ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(current && player.isPlaying ? "Pause" : "Play") \(track.title)")
            Button(action: activate) {
                VStack(alignment: .leading, spacing: 2) {
                    SongName.title(track).font(DS.Font.subheadStrong).foregroundStyle(ready ? DS.Color.ink : DS.Color.inkMuted).lineLimit(1)
                    Text(SongName.subtitle(track)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(SongName.displayLine(track))
            Text(ready ? macTime(track.duration ?? 0) : "Not downloaded")
                .font(ready ? DS.Font.time : DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            Menu {
                Button("Move up", action: up).disabled(first)
                Button("Move down", action: down).disabled(last)
                Divider()
                Button("Remove", role: .destructive, action: remove)
            } label: {
                Image(systemName: "ellipsis").frame(width: 28, height: 28).contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .accessibilityLabel("More: \(track.title)")
        }
        .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space2)
        .background(current ? DS.Color.accentTint : Color.clear)
        .onHover { hover = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(current ? .isSelected : [])
    }

    private func activate() {
        if current { player.toggle() }
        else if let i = player.queue.firstIndex(where: { $0.id == track.id }) { player.jump(to: i) }
    }
}

private struct TagPickerSheet: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var library: LibraryStore
    @ObservedObject private var mac = MacPlayback.shared
    @Environment(\.dismiss) private var dismiss
    @State private var picks: Set<String> = []

    private var songs: [Track] { library.songs.filter(playable) }
    private var groups: [TagGroup] { tagGroups(tagCounts(songs.map { $0.tags ?? [] })) }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space4) {
            Text("Add songs by tag").font(DS.Font.title).foregroundStyle(DS.Color.ink)
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space4) {
                    ForEach(groups) { group in
                        VStack(alignment: .leading, spacing: DS.Space.space2) {
                            Text(group.name.uppercased()).font(DS.Font.eyebrow).tracking(DS.Font.eyebrowTracking).foregroundStyle(DS.Color.inkMuted)
                            PlaybackFlow {
                                ForEach(group.tags, id: \.tag) { item in
                                    let on = picks.contains(item.tag.lowercased())
                                    Button { toggle(item.tag) } label: {
                                        Text("\(tagLabel(item.tag)) \(item.count)").font(DS.Font.caption)
                                            .foregroundStyle(on ? DS.Color.onAccent : DS.Color.ink)
                                            .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space1)
                                            .background(Capsule().fill(on ? DS.Color.accent : DS.Color.surfaceSunken))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityAddTraits(on ? .isSelected : [])
                                }
                            }
                        }
                    }
                    if groups.isEmpty {
                        Text("No tags yet").font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Add songs", action: apply).keyboardShortcut(.defaultAction)
            }
        }
        .padding(DS.Space.space6)
        .frame(width: 520, height: 460)
        .onAppear { picks = Set(player.queueTags.map { $0.lowercased() }) }
    }

    private func toggle(_ tag: String) {
        let k = tag.lowercased()
        if picks.contains(k) { picks.remove(k) } else { picks.insert(k) }
    }

    private func apply() {
        let all = groups.flatMap(\.tags).map(\.tag)
        let chosen = all.filter { picks.contains($0.lowercased()) }
        for old in player.queueTags where !picks.contains(old.lowercased()) { player.removeQueueTag(old) }
        let added = chosen.isEmpty ? 0 : player.addTagged(chosen, from: songs)
        if added > 0 { mac.show("Added \(added) song\(added == 1 ? "" : "s")") }
        dismiss()
    }
}
