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
    var listenedCount: Int? = nil
    var toggleQueue: (() -> Void)? = nil
    let play: () -> Void
    let details: () -> Void
    let download: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var scaledCover = DS.Component.coverRow
    private var cover: CGFloat { min(scaledCover, DS.Component.coverRow * 1.5) }
    private var noAudio: Bool { !onPhone && progress == nil && track.onServer == false }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize { stackedLayout } else { inlineLayout }
        }
        .frame(maxWidth: .infinity, minHeight: cover + DS.Space.space3 * 2)
        .background {
            (playing ? DS.Color.accentTint : DS.Color.surface).contentShape(Rectangle()).onTapGesture(perform: details)
        }
        .allowsHitTesting(!arriving).accessibilityElement(children: .ignore).accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(arriving ? [] : .isButton).accessibilityAddTraits(playing ? .isSelected : [])
        .accessibilityAction { if !arriving { play() } }
    }

    private var inlineLayout: some View {
        HStack(spacing: 0) {
            coverButton
            HStack(alignment: .firstTextBaseline, spacing: DS.Space.space2) {
                textColumn
                VStack(alignment: .trailing, spacing: DS.Space.space1) {
                    durationButton
                    audioState(fullWidth: false)
                    queueMarker
                }
            }.padding(.vertical, DS.Space.space3)
            playCount.padding(.leading, DS.Space.space3)
        }
        .padding(.trailing, DS.Space.space3)
    }

    private var stackedLayout: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack(alignment: .top, spacing: DS.Space.space3) {
                coverButton
                textColumn
            }
            HStack(spacing: DS.Space.space3) {
                durationButton
                audioState(fullWidth: true)
                queueMarker
                playCount
            }
        }.padding(DS.Space.space3)
    }

    private var coverButton: some View {
        Button(action: play) {
            CoverImage(source: track.thumbnail).frame(width: cover, height: cover)
                .overlay {
                    if playing {
                        DS.Color.coverScrim
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: DS.Icon.iconPlay)).foregroundStyle(DS.Color.surface)
                            .accessibilityHidden(true)
                    } else if onPhone {
                        Circle().fill(DS.Color.coverScrim).frame(width: DS.Component.iconButton, height: DS.Component.iconButton)
                            .overlay {
                                Image(systemName: "play.fill").font(.system(size: DS.Icon.iconInline)).foregroundStyle(DS.Color.surface)
                            }.accessibilityHidden(true)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm)).opacity(noAudio ? DS.Opacity.dim : 1)
                .padding(typeSize.isAccessibilitySize ? 0 : DS.Space.space3).contentShape(Rectangle())
        }.buttonStyle(LibraryCoverPressStyle())
    }

    private var textColumn: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            Button(action: details) {
                Text(track.title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(typeSize.isAccessibilitySize ? 3 : 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(noAudio ? DS.Opacity.dim : 1).contentShape(Rectangle())
            }.buttonStyle(LibraryPressStyle())
            Button(action: details) {
                Text(track.librarySubtitle).font(T.subhead).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted)
                    .lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                    .opacity(noAudio ? DS.Opacity.dim : 1)
                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(LibraryPressStyle())
        }.frame(maxWidth: .infinity, alignment: .leading)
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

    @ViewBuilder private var playCount: some View {
        if let listenedCount, listenedCount > 0 {
            HStack(spacing: DS.Space.space1) {
                Image(systemName: "headphones").font(.system(size: DS.Icon.iconInline))
                Text(String(listenedCount)).font(T.subhead).monospacedDigit()
            }
            .foregroundStyle(DS.Color.inkMuted).fixedSize().accessibilityHidden(true)
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
                Text("Download").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .padding(.horizontal, DS.Space.space3).frame(maxWidth: fullWidth ? .infinity : nil, minHeight: DS.Component.iconButton)
                    .overlay(Capsule().strokeBorder(DS.Color.accentInk, lineWidth: DS.Stroke.strokeThin))
                    .frame(minHeight: DS.Space.hit).contentShape(Rectangle())
            }.buttonStyle(LibraryPressStyle())
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
        return offline ? "on server, offline" : "on server"
    }
    private var playState: String {
        if !playing { return "" }
        return isPlaying ? "playing" : "paused"
    }
    private var accessibilityLabel: String {
        return [track.title, track.libraryArtist, track.libraryYear.map(String.init) ?? "", track.duration.map(formatTime) ?? "", transferState,
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
