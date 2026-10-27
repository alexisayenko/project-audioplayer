import SwiftUI

struct CoverImage: View {
    let source: String?
    @EnvironmentObject var settings: Settings
    @Environment(\.displayScale) private var displayScale
    @State private var loaded: (source: String, image: UIImage)?
    @State private var side: CGFloat = 0

    private var pixels: Int { CoverCache.bucket(forPixels: side * displayScale) }

    var body: some View {
        let shown = source.flatMap { CoverCache.cached($0, baseURL: settings.serverURL, pixels: pixels) }
            ?? loaded.flatMap { $0.source == source ? $0.image : nil }
        Group {
            if let shown {
                Image(uiImage: shown).resizable().scaledToFill()
            } else if !LocalCover.isLocal(source), let url = CoverURL.resolve(source, baseURL: settings.serverURL, token: ""), !CoverCache.isServerCover(source) {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { placeholder }
            } else {
                placeholder
            }
        }
        .onGeometryChange(for: CGFloat.self) { max($0.size.width, $0.size.height) } action: { side = $0 }
        .task(id: "\(source ?? "")#\(CoverEpoch.shared.value)#\(pixels)") { await load() }
    }

    private var placeholder: some View {
        GeometryReader { g in
            Image("ThumbnailRecord")
                .resizable()
                .scaledToFit()
                .frame(width: min(g.size.width, g.size.height),
                       height: min(g.size.width, g.size.height))
                .position(x: g.size.width / 2, y: g.size.height / 2)
                .accessibilityHidden(true)
        }
    }

    /// Server covers are fetched with the auth header, never with a token in the URL.
    private func load() async {
        if let source, LocalCover.isLocal(source) {
            let local = await LocalCover.image(for: source, pixels: pixels)
            loaded = local.map { (source, $0) }
            return
        }
        guard let source, CoverCache.isServerCover(source) else { loaded = nil; return }
        let fetched = await CoverCache.image(for: source, baseURL: settings.serverURL, token: settings.token, pixels: pixels)
        loaded = fetched.map { (source, $0) }
    }
}

/// Song row: cover, title, artist, duration or "Downloading NN%", and a menu slot.
struct SongRow<Menu: View>: View {
    let title: String
    let subtitle: String
    var source: String?
    let thumbnail: String?
    var duration: Double?
    var downloading: Double?
    var onDownload: (() -> Void)?
    var noAudio = false
    var playing = false
    var coverSize: CGFloat = 56
    @Environment(\.dynamicTypeSize) private var typeSize
    @ViewBuilder var menu: () -> Menu

    var body: some View {
        HStack(spacing: DS.Space.space3) {
            CoverImage(source: thumbnail)
                .frame(width: coverSize, height: coverSize)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .opacity(noAudio ? 0.55 : 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                let artist = Text(subtitle).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted).lineLimit(1)
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 0) {
                        artist
                        if let source { Text(sourceLabel(source)).foregroundStyle(DS.Color.inkFaint).lineLimit(1).minimumScaleFactor(0.7) }
                    }
                    .font(T.subhead)
                } else {
                    HStack(spacing: 0) {
                        artist.layoutPriority(1)
                        if let source {
                            Text(" \u{00B7} " + sourceLabel(source)).foregroundStyle(DS.Color.inkFaint).lineLimit(1)
                        }
                    }
                    .font(T.subhead)
                }
            }
            .opacity(noAudio ? 0.55 : 1)
            Spacer(minLength: 0)
            if let onDownload {
                Button(action: onDownload) {
                    Text("Download").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
                        .overlay(Capsule().stroke(DS.Color.accentInk, lineWidth: 1.5))
                        .contentShape(Capsule().inset(by: -6))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Download \(title)")
            } else if noAudio {
                Text("No audio yet").font(T.caption).foregroundStyle(DS.Color.inkMuted)
                    .multilineTextAlignment(.trailing).frame(maxWidth: 84, alignment: .trailing).fixedSize(horizontal: false, vertical: true)
            } else if let downloading {
                Text("Downloading \(Int(downloading * 100))%").font(T.caption).foregroundStyle(DS.Color.accentInk)
                    .lineLimit(typeSize.isAccessibilitySize ? 2 : 1).multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: true)
            } else if let duration {
                Text(formatTime(duration)).font(T.time).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted)
            }
            menu()
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space3)
        .frame(minHeight: DS.Space.hit)
        .background(playing ? DS.Color.accentTint : Color.clear)
        .contentShape(Rectangle())
    }
}

extension SongRow where Menu == EmptyView {
    init(title: String, subtitle: String, source: String? = nil, thumbnail: String?, duration: Double? = nil,
         downloading: Double? = nil, onDownload: (() -> Void)? = nil, noAudio: Bool = false, playing: Bool = false,
         coverSize: CGFloat = 56) {
        self.init(title: title, subtitle: subtitle, source: source, thumbnail: thumbnail, duration: duration, downloading: downloading,
                  onDownload: onDownload, noAudio: noAudio, playing: playing, coverSize: coverSize) { EmptyView() }
    }
}
