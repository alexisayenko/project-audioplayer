import SwiftUI

struct LibrarySongRow: View {
    let track: Track
    var progress: Double?
    let onPhone: Bool
    let playing: Bool
    let isPlaying: Bool
    let queued: Bool
    let waiting: Bool
    var arriving = false
    var offline = false
    var retry = false
    var listenedCount: Int? = nil
    var trackNumber: Int? = nil
    var albumArtist: String? = nil
    var toggleQueue: (() -> Void)? = nil
    let play: () -> Void
    let details: () -> Void
    let download: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var scaledCover = DS.Component.coverRow
    private var cover: CGFloat { trackNumber != nil ? DS.Space.hit : min(scaledCover, DS.Component.coverRow * 1.5) }
    private var hasMeta: Bool { (!noAudio && (track.duration ?? 0) > 0) || (listenedCount ?? 0) > 0 }
    private var noAudio: Bool { !onPhone && progress == nil && track.onServer == false }
    private var subtitleEmpty: Bool {
        guard let albumArtist else { return false }
        let artist = track.libraryArtist
        return artist.isEmpty || artist.caseInsensitiveCompare(albumArtist) == .orderedSame
    }
    private var rowPad: CGFloat { subtitleEmpty ? DS.Space.space2 : DS.Space.space3 }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize { stackedLayout } else { inlineLayout }
        }
        .frame(maxWidth: .infinity, minHeight: cover + rowPad * 2)
        .background {
            (playing ? DS.Color.accentTint : DS.Color.surface).contentShape(Rectangle()).onTapGesture(perform: details)
        }
        .allowsHitTesting(!arriving).accessibilityElement(children: .ignore).accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(arriving ? [] : .isButton).accessibilityAddTraits(playing ? .isSelected : [])
        .accessibilityAction { if !arriving { play() } }
    }

    private var inlineLayout: some View {
        HStack(spacing: 0) {
            trackNumberLabel.padding(.leading, trackNumber == nil ? 0 : DS.Space.space3)
            coverButton
            HStack(alignment: .center, spacing: DS.Space.space2) {
                textColumn.layoutPriority(0)
                HStack(alignment: .center, spacing: DS.Space.space2) {
                    if hasMeta {
                        VStack(alignment: .trailing, spacing: 0) {
                            durationButton
                            playCount(inline: true)
                        }
                    }
                    audioState(fullWidth: false)
                    queueMarker
                }.fixedSize(horizontal: true, vertical: false).layoutPriority(2)
            }.padding(.vertical, rowPad)
        }
        .padding(.trailing, DS.Space.space3)
    }

    private var stackedLayout: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack(alignment: .top, spacing: DS.Space.space3) {
                trackNumberLabel
                coverButton
                if trackNumber != nil {
                    HStack(alignment: .top, spacing: DS.Space.space2) {
                        textColumn
                        durationButton.fixedSize(horizontal: true, vertical: false)
                    }
                } else {
                    textColumn
                }
            }
            HStack(spacing: DS.Space.space3) {
                if trackNumber == nil { durationButton }
                audioState(fullWidth: true)
                queueMarker
                playCount(inline: false)
            }
        }.padding(DS.Space.space3).padding(.trailing, DS.Space.space3)
    }

    @ViewBuilder private var trackNumberLabel: some View {
        if let trackNumber {
            Text(String(trackNumber)).font(T.time).foregroundStyle(DS.Color.inkMuted)
                .frame(minWidth: DS.Space.space6, alignment: .trailing).accessibilityHidden(true)
        }
    }

    private var coverButton: some View {
        Button(action: play) {
            CoverImage(source: track.thumbnail).frame(width: cover, height: cover)
                .overlay {
                    if playing {
                        DS.Color.coverScrim
                        CoverGlyph(symbol: isPlaying ? "pause.fill" : "play.fill", size: DS.Icon.iconPlay)
                    } else if onPhone {
                        Circle().fill(DS.Color.coverScrim).frame(width: DS.Component.iconButton, height: DS.Component.iconButton)
                            .overlay { CoverGlyph(symbol: "play.fill", size: DS.Icon.iconInline) }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm)).opacity(noAudio ? DS.Opacity.dim : 1)
                .padding(.horizontal, typeSize.isAccessibilitySize ? 0 : (trackNumber != nil ? DS.Space.space2 : DS.Space.space3))
                .padding(.vertical, typeSize.isAccessibilitySize ? 0 : rowPad).contentShape(Rectangle())
        }.buttonStyle(LibraryCoverPressStyle())
    }

    private var textColumn: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            Button(action: details) {
                Text(track.title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(typeSize.isAccessibilitySize ? 3 : 2)
                    .minimumScaleFactor(typeSize.isAccessibilitySize && trackNumber != nil ? 0.7 : 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(noAudio ? DS.Opacity.dim : 1).contentShape(Rectangle())
            }.buttonStyle(LibraryPressStyle())
            subtitle
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var subtitle: some View {
        if albumArtist != nil {
            if !subtitleEmpty {
                subtitleButton { Text(track.libraryArtist).lineLimit(typeSize.isAccessibilitySize ? 3 : 1) }
            }
        } else if typeSize.isAccessibilitySize {
            subtitleButton { Text([track.libraryArtist, track.libraryYear.map(String.init) ?? ""].filter { !$0.isEmpty }.joined(separator: "\u{00A0}·\u{00A0}")).lineLimit(3) }
        } else {
            subtitleButton {
                Text([track.libraryArtist, track.libraryYear.map(String.init) ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")).lineLimit(1)
            }
        }
    }

    private func subtitleButton<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        Button(action: details) {
            content().font(T.subhead).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted)
                .opacity(noAudio ? DS.Opacity.dim : 1)
                .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }.buttonStyle(LibraryPressStyle())
    }

    @ViewBuilder private var durationButton: some View {
        if !noAudio, let duration = track.duration, duration > 0 {
            Button(action: details) {
                Text(formatTime(duration)).font(T.time)
                    .foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted)
                    .fixedSize().accessibilityHidden(true)
            }.buttonStyle(LibraryPressStyle())
        }
    }

    @ViewBuilder private func playCount(inline: Bool) -> some View {
        if let listenedCount, listenedCount > 0 {
            HStack(spacing: DS.Space.space1) {
                Image(systemName: "headphones").dsIcon(DS.Icon.iconInline)
                Text(String(listenedCount)).font(inline ? T.caption : T.subhead).monospacedDigit()
            }
            .foregroundStyle(DS.Color.inkMuted).lineLimit(1).fixedSize()
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder private func audioState(fullWidth: Bool) -> some View {
        if !onPhone, let progress {
            Button(action: details) {
                Text(waiting ? "Waiting…" : "Downloading \(Int(min(1, max(0, progress)) * 100))%")
                    .font(T.caption).foregroundStyle(DS.Color.accentInk).lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                    .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true).frame(minHeight: DS.Space.hit)
            }.buttonStyle(LibraryPressStyle())
        } else if !onPhone && !noAudio && offline {
            Text("Offline").font(T.caption).foregroundStyle(DS.Color.inkMuted)
                .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: DS.Space.hit)
        } else if !onPhone && !noAudio {
            Button(action: download) {
                if typeSize.isAccessibilitySize {
                    Image(systemName: retry ? "arrow.clockwise" : "arrow.down.circle").dsIcon(DS.Icon.iconNav, weight: DS.Icon.iconWeight)
                        .foregroundStyle(DS.Color.accentInk)
                        .frame(maxWidth: fullWidth ? .infinity : nil, alignment: .trailing)
                        .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit).contentShape(Rectangle())
                } else {
                    Text(retry ? "Retry" : "Download").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .lineLimit(1).multilineTextAlignment(.center).fixedSize(horizontal: true, vertical: true)
                        .padding(.horizontal, fullWidth ? DS.Space.space3 : 0).frame(maxWidth: fullWidth ? .infinity : nil, minHeight: DS.Component.iconButton)
                        .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit).contentShape(Rectangle())
                }
            }.buttonStyle(LibraryPressStyle()).accessibilityLabel(retry ? "Retry download" : "Download")
        } else if noAudio {
            Button(action: details) {
                Text("No audio yet")
                    .font(T.caption).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted)
                    .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .trailing).frame(minHeight: DS.Space.hit)
            }.buttonStyle(LibraryPressStyle())
        }
    }
    @ViewBuilder private var queueMarker: some View {
        if playing || (queued && toggleQueue == nil) {
            Image("queue.included").renderingMode(.template).resizable()
                .frame(width: DS.Icon.iconPlay, height: DS.Icon.iconPlay)
                .foregroundStyle(DS.Color.accentInk).frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
        } else if let toggleQueue {
            Button(action: toggleQueue) {
                Image(queued ? "queue.included" : "queue.add").renderingMode(.template).resizable()
                    .frame(width: DS.Icon.iconPlay, height: DS.Icon.iconPlay)
                    .foregroundStyle(queued ? DS.Color.accentInk : DS.Color.inkMuted)
                    .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                    .contentShape(Rectangle())
            }.buttonStyle(LibraryPressStyle()).accessibilityLabel(queued ? "Remove from queue" : "Add to queue")
        }
    }
    private var transferState: String {
        if onPhone { return "on iPhone" }
        if let progress {
            return waiting ? "waiting for the server" : "downloading \(Int(progress * 100)) percent"
        }
        if noAudio { return "no audio yet" }
        if offline { return "on server, offline" }
        return retry ? "on server, download failed" : "on server"
    }
    private var playState: String {
        if !playing { return "" }
        return isPlaying ? "playing" : "paused"
    }
    private var accessibilityLabel: String {
        return [trackNumber.map { "Track \($0)" } ?? "", track.title, track.libraryArtist, track.libraryYear.map(String.init) ?? "", track.duration.map(formatTime) ?? "", transferState,
                queued ? "in queue" : "", playState,
                listenedCount.map { "Listened \($0) \($0 == 1 ? "time" : "times")" } ?? ""].filter { !$0.isEmpty }.joined(separator: ", ")
    }
    static let inert: () -> Void = {
        // Rows that are still arriving are not interactive.
    }
}

struct LibraryCoverPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? DS.Motion.enterScale : 1)
            .dsAnimation(DS.Motion.durFast, value: configuration.isPressed)
    }
}

private struct CoverGlyph: View {
    let symbol: String
    let size: CGFloat

    var body: some View {
        Image(systemName: symbol).font(.system(size: size)).foregroundStyle(DS.Color.surface)
            .environment(\.colorScheme, .light).accessibilityHidden(true)
    }
}
