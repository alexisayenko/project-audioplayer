import SwiftUI

struct PlaybackView: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var library: LibraryStore
    @State private var showTags = false
    @State private var toast: String?

    private var current: Track? { player.current }

    private func subtitle(_ t: Track) -> String {
        [t.artist, t.album, t.year.map(String.init)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                    VStack(spacing: 12) {
                        Turntable()
                        details
                        VStack(spacing: 2) {
                            Slider(value: Binding(get: { player.position }, set: { player.seek(to: $0) }),
                                   in: 0...max(player.duration, 1))
                                .tint(Theme.cyan).disabled(current == nil)
                            HStack {
                                Text(formatTime(player.position))
                                Spacer()
                                Text(formatTime(player.duration))
                            }
                            .font(.caption.monospacedDigit()).foregroundStyle(Theme.labelDim)
                        }
                        controlPanel
                        playlistPanel
                    }
                }
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
                Section {
                    if player.queue.isEmpty {
                        Text("Queue is empty. Add songs from Library.").foregroundStyle(Theme.labelDim)
                            .listRowBackground(Color.clear)
                    }
                    ForEach(Array(player.queue.enumerated()), id: \.element.id) { i, track in
                        Button { player.jump(to: i) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    TrackRow(title: track.title, subtitle: subtitle(track), thumbnail: track.thumbnail,
                                             highlighted: i == player.index)
                                    Spacer(minLength: 0)
                                    if let d = track.duration {
                                        Text(formatTime(d)).font(.caption.monospacedDigit()).foregroundStyle(Theme.labelDim)
                                    }
                                }
                                if let tags = track.tags, !tags.isEmpty { TagList(tags: tags) }
                            }
                        }
                        .panelRow()
                    }
                    .onDelete { player.removeFromQueue(at: $0) }
                } header: { Text("Queue · ОЧЕРЕДЬ").panelLabel() }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(WoodBackground())
            .navigationTitle("Playback")
            .navigationBarTitleDisplayMode(.inline)
            .woodBar(.navigationBar)
            .overlay(alignment: .top) {
                if let toast {
                    Text(toast).font(.footnote).padding(8).foregroundStyle(Theme.label).background(Theme.panelRaised)
                        .clipShape(Capsule()).overlay(Capsule().stroke(Theme.chromeEdge, lineWidth: 1))
                        .task(id: toast) { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                }
            }
            .sheet(isPresented: $showTags) {
                TagPickerSheet { picks in
                    let n = player.addTagged(picks, from: library.tracks)
                    toast = n == 0 ? "No new songs for these tags" : "Added \(n) \(n == 1 ? "song" : "songs")"
                }
            }
        }
    }

    private var details: some View {
        VStack(spacing: 6) {
            if let t = current {
                Text(t.title).font(.title3.bold()).lineLimit(2).foregroundStyle(Theme.label)
                Text(subtitle(t)).foregroundStyle(Theme.labelDim)
                if let tags = t.tags, !tags.isEmpty { TagList(tags: tags).frame(maxWidth: .infinity, alignment: .center) }
                HStack(spacing: 12) {
                    if let bpm = t.bpm { Text("\(Int(bpm.rounded())) BPM").font(.caption.weight(.semibold)).foregroundStyle(Theme.labelDim) }
                    ForEach(links(t), id: \.0) { label, url in
                        Link(label, destination: url).font(.caption.weight(.semibold)).foregroundStyle(Theme.cyan)
                    }
                }
            } else {
                Text("Nothing playing").foregroundStyle(Theme.labelDim)
            }
        }
        .multilineTextAlignment(.center)
    }

    private func links(_ t: Track) -> [(String, URL)] {
        [("Source", t.sourceURL), ("Wikipedia (song)", t.wikipediaSong), ("Wikipedia (band)", t.wikipediaArtist)]
            .compactMap { label, s in
                guard let s, s.lowercased().hasPrefix("http"), let u = URL(string: s) else { return nil }
                return (label, u)
            }
    }

    private var controlPanel: some View {
        HStack(alignment: .center, spacing: 16) {
            RotaryKnob(value: Binding(get: { player.volume }, set: { player.volume = $0 }),
                       title: "Volume", cyrillic: "ГРОМКОСТЬ")
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    LED(on: player.isPlaying, color: Theme.red)
                    Text("Play · СЕТЬ").font(.system(size: 10, weight: .semibold, design: .rounded)).foregroundStyle(Theme.labelDim)
                    Spacer(minLength: 0)
                }
                HStack(spacing: 6) {
                    PianoButton(action: { player.previous() }) { Image(systemName: "backward.fill") }
                        .accessibilityLabel("Previous song")
                    PianoButton(tint: Theme.red, action: { player.toggle() }) {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    }
                    .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                    PianoButton(action: { player.next() }) { Image(systemName: "forward.fill") }
                        .accessibilityLabel("Next song")
                }
                HStack(spacing: 6) {
                    PianoButton(action: { player.skip(by: -5) }) { Image(systemName: "gobackward.5") }
                        .accessibilityLabel("Back 5 seconds")
                    PianoButton(action: { player.skip(by: 5) }) { Image(systemName: "goforward.5") }
                        .accessibilityLabel("Forward 5 seconds")
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.chromeEdge, lineWidth: 1.5))
    }

    private var playlistPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                PianoButton(lit: player.shuffle, action: { player.shuffle.toggle() }) { Image(systemName: "shuffle") }
                    .accessibilityLabel("Shuffle: \(player.shuffle ? "on" : "off")")
                PianoButton(lit: player.repeatMode == .one, action: { player.repeatMode = player.repeatMode == .one ? .off : .one }) {
                    Image(systemName: "repeat.1")
                }
                .accessibilityLabel("Loop one song: \(player.repeatMode == .one ? "on" : "off")")
                PianoButton(lit: player.repeatMode == .all, action: { player.repeatMode = player.repeatMode == .all ? .off : .all }) {
                    Image(systemName: "repeat")
                }
                .accessibilityLabel("Loop whole list: \(player.repeatMode == .all ? "on" : "off")")
                PianoButton(action: { player.clearQueue() }) { Text("Clean").font(.caption.smallCaps().weight(.semibold)) }
                    .accessibilityLabel("Clean playlist")
                PianoButton(action: { showTags = true }) { Image(systemName: "tag") }
                    .accessibilityLabel("Add songs by tag")
                Spacer(minLength: 0)
            }
            if !player.queueTags.isEmpty {
                FlowLayout {
                    ForEach(player.queueTags, id: \.self) { t in
                        TagChip(text: tagLabel(t), on: true, removable: true) { player.removeQueueTag(t) }
                    }
                }
            }
            Text("\(player.queue.count) \(player.queue.count == 1 ? "song" : "songs")").panelLabel()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.chromeEdge, lineWidth: 1.5))
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
                VStack(alignment: .leading, spacing: 12) {
                    if groups.isEmpty { Text("No tags on the phone yet.").foregroundStyle(Theme.labelDim) }
                    ForEach(groups) { g in
                        Text(g.name).panelLabel()
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
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .panelBackground()
            .navigationTitle("Add songs by tag")
            .navigationBarTitleDisplayMode(.inline)
            .woodBar(.navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.tint(.white) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { onAdd(picks); dismiss() }.tint(.white).disabled(picks.isEmpty)
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
    }
}
