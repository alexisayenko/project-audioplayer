import SwiftUI

struct MacTransportBar: View {
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var nav: MacNavigation
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @ObservedObject private var mac = MacPlayback.shared
    @ObservedObject private var viz = MacVisualizer.shared
    @State private var premute: Double = 1

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.clear.frame(height: 0)
            VStack(spacing: DS.Space.space2) {
                if let toast = mac.toast {
                    Text(toast).font(DS.Font.caption).foregroundStyle(DS.Color.ink)
                        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
                        .background(Capsule().fill(DS.Color.surface))
                        .overlay(Capsule().strokeBorder(DS.Color.line))
                        .shadow(color: DS.Color.vinyl.opacity(0.25), radius: 8, y: 2)
                        .transition(.opacity)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                if let track = player.current { dock(track) }
            }
            .padding(.horizontal, DS.Space.space4).padding(.bottom, player.current == nil && mac.toast == nil ? 0 : DS.Space.space4)
            .animation(.easeOut(duration: 0.2), value: mac.toast)
        }
        .task { mac.install(player: player, settings: settings, library: library) }
    }

    private func dock(_ track: Track) -> some View {
        let shape = RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous)
        return HStack(spacing: DS.Space.space3) {
            Button { player.toggle() } label: {
                PlaybackCover(source: track.thumbnail, radius: DS.Radius.radiusKey).frame(width: 66, height: 66)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(player.isPlaying ? "Pause" : "Play") \(track.title)")
            VStack(spacing: 6) {
                HStack(spacing: DS.Space.space3) {
                    Button(action: openSong) {
                        VStack(alignment: .leading, spacing: 1) {
                            SongName.title(track).font(DS.Font.subheadStrong).foregroundStyle(DS.Color.ink).lineLimit(1)
                            Text(statusLine(track)).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(SongName.displayLine(track))
                    keys
                }
                HStack(spacing: DS.Space.space3) {
                    Text("\(macTime(player.position)) / \(macTime(player.duration))")
                        .font(DS.Font.time).foregroundStyle(DS.Color.inkMuted).fixedSize()
                    MacScrubber(value: player.position, range: 0...max(player.duration, 1), label: "Position",
                                disabled: player.duration <= 0, bubble: macTime, keyStep: 5,
                                onCommit: { player.seek(to: $0) })
                    volume
                }
            }
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
        .frame(maxWidth: 720)
        .frame(height: 92)
        .background(shape.fill(DS.Color.surface))
        .overlay(shape.strokeBorder(DS.Color.line, lineWidth: DS.Stroke.strokeHairline))
        .shadow(color: DS.Color.vinyl.opacity(0.3), radius: 16, y: 4)
    }

    private var keys: some View {
        HStack(spacing: DS.Space.space2) {
            Button { viz.toggle() } label: { Image(systemName: "waveform") }
                .buttonStyle(MacKeyStyle(kind: .toggle(viz.isOpen)))
                .disabled(!viz.available)
                .help(viz.tooltip)
                .accessibilityLabel("Visualizer").accessibilityValue(viz.isOpen ? "on" : "off")
            Button { player.shuffle.toggle() } label: { Image(systemName: "shuffle") }
                .buttonStyle(MacKeyStyle(kind: .toggle(player.shuffle)))
                .help("Shuffle").accessibilityLabel("Shuffle").accessibilityValue(player.shuffle ? "on" : "off")
            Button { player.previous() } label: { Image(systemName: "backward.end.fill") }
                .buttonStyle(MacKeyStyle()).help("Previous").accessibilityLabel("Previous song")
            Button { player.toggle() } label: { Image(systemName: player.isPlaying ? "pause.fill" : "play.fill") }
                .buttonStyle(MacKeyStyle(kind: .lit)).help(player.isPlaying ? "Pause" : "Play")
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            Button { player.next() } label: { Image(systemName: "forward.end.fill") }
                .buttonStyle(MacKeyStyle()).disabled(!player.hasNext).help("Next").accessibilityLabel("Next song")
            Button { player.repeatMode = player.repeatMode.next } label: {
                Image(systemName: player.repeatMode == .one ? "repeat.1" : "repeat")
            }
            .buttonStyle(MacKeyStyle(kind: .toggle(player.repeatMode != .off)))
            .help("Repeat: \(player.repeatMode.spokenName)")
            .accessibilityLabel("Repeat").accessibilityValue(player.repeatMode.spokenName)
        }
    }

    private var volume: some View {
        HStack(spacing: DS.Space.space2) {
            Button {
                if player.volume > 0 { premute = player.volume; player.volume = 0 } else { player.volume = max(premute, 0.05) }
            } label: {
                Image(systemName: player.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 13)).foregroundStyle(DS.Color.inkMuted).frame(width: 20, height: 28)
            }
            .buttonStyle(.plain)
            .help(player.volume == 0 ? "Unmute" : "Mute")
            .accessibilityLabel(player.volume == 0 ? "Unmute" : "Mute")
            MacScrubber(value: player.volume, range: 0...1, label: "Volume", thumb: 12,
                        bubble: { "\(Int(($0 * 100).rounded()))%" }, keyStep: 0.05,
                        onChange: { player.volume = $0 }, onCommit: { player.volume = $0 })
                .frame(width: 96)
        }
    }

    private func statusLine(_ track: Track) -> String {
        if track.onServer == false && !FileManager.default.fileExists(atPath: track.fileURL.path) { return "Not downloaded" }
        if player.failedTrackID == track.id { return "Cannot play this song" }
        return SongName.artistLine(track)
    }

    private func openSong() {
        if nav.page == .library { NotificationCenter.default.post(name: .macRevealPlayingSong, object: player.current?.id) }
        else { nav.page = .playback }
    }
}
