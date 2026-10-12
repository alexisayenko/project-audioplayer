import SwiftUI

/// Dynamic Type counterparts of the DS.Font roles (same roles, same default sizes, but scalable).
enum T {
    static let display = Font.largeTitle.bold()
    static let title = Font.title2.bold()
    static let headline = Font.headline
    static let body = Font.body
    static let subhead = Font.subheadline
    static let caption = Font.footnote
    static let eyebrow = Font.caption.weight(.semibold)
    static let time = Font.footnote.monospaced().weight(.medium)
}

extension ColorScheme {
    /// Fill for primary buttons and selected chips. Night uses the lit accent: white on accent-strong is 3.4:1, on-accent on accent is 8.5:1.
    var strongFill: Color { self == .dark ? DS.Color.accent : DS.Color.accentStrong }
    /// Label on `strongFill`: ink by day (4.8:1), on-accent by night (8.5:1).
    var onStrong: Color { self == .dark ? DS.Color.onAccent : DS.Color.ink }
}

extension View {
    /// A flat glass slab: surface, soft ambient shadow, no border.
    func dsSlab(radius: CGFloat = DS.Radius.radiusCard, fill: Color = DS.Color.surface) -> some View {
        background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill)
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2))
    }

    func dsGround() -> some View { background(DS.Color.ground.ignoresSafeArea()) }

    func dsField() -> some View {
        font(T.subhead).foregroundStyle(DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 40)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceSunken))
    }

    func dsCaption() -> some View { font(T.caption).foregroundStyle(DS.Color.inkMuted) }
}

struct ScreenHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Electrophone".uppercased()).font(T.eyebrow).tracking(DS.Font.eyebrowTracking)
                    .foregroundStyle(DS.Color.inkMuted)
                Text(title).font(T.display).foregroundStyle(DS.Color.ink).lineLimit(2).minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle { Text(subtitle).font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
            }
            Spacer(minLength: DS.Space.space2)
            trailing()
        }
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) { self.init(title: title, subtitle: subtitle) { EmptyView() } }
}

struct SectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            .padding(.leading, DS.Space.space1).accessibilityAddTraits(.isHeader)
    }
}

/// Signal dot. `glow` adds the soft halo of a lit LED.
struct LED: View {
    var color: Color
    var size: CGFloat = 8
    var glow = false

    var body: some View {
        Circle().fill(color).frame(width: size, height: size)
            .shadow(color: glow ? color.opacity(0.8) : .clear, radius: 3)
            .accessibilityHidden(true)
    }
}

/// LED plus a status word, e.g. "Server online".
struct StatusLine: View {
    let color: Color
    let text: String

    var body: some View {
        HStack(spacing: DS.Space.space2) {
            LED(color: color, glow: true)
            Text(text).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.ink)
        }
        .accessibilityElement(children: .combine)
    }
}

enum DSButtonKind { case primary, outline, quiet, danger }

struct DSButtonStyle: ButtonStyle {
    var kind: DSButtonKind = .primary
    var tall = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let label = configuration.label
            .font(tall ? T.headline : T.subhead.weight(.semibold))
            .lineLimit(2).multilineTextAlignment(.center)
            .padding(.horizontal, DS.Space.space4)
            .frame(maxWidth: tall ? .infinity : nil, minHeight: tall ? 52 : DS.Space.hit)
        return Group {
            switch kind {
            case .primary:
                label.foregroundStyle(scheme.onStrong)
                    .background(Capsule().fill(scheme.strongFill))
            case .outline:
                label.foregroundStyle(DS.Color.accentInk)
                    .overlay(Capsule().stroke(DS.Color.accentInk, lineWidth: 1.5))
            case .quiet:
                label.foregroundStyle(DS.Color.ink)
                    .background(Capsule().fill(DS.Color.surfaceKey).shadow(color: DS.Color.vinyl.opacity(0.16), radius: 2, y: 1))
            case .danger:
                label.foregroundStyle(DS.Color.ink)
                    .overlay(Capsule().stroke(DS.Color.power, lineWidth: 1.5))
            }
        }
        .contentShape(Capsule())
        .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}

struct CategoryChip: View {
    let title: String
    let count: Int
    var selected = 0
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let on = selected > 0
        Button(action: action) {
            HStack(spacing: DS.Space.space1) {
                Text(title).font(T.subhead.weight(on ? .semibold : .medium)).lineLimit(1).minimumScaleFactor(0.7)
                Text("\(on ? selected : count)").font(T.caption)
                    .foregroundStyle(on ? scheme.onStrong : DS.Color.inkMuted)
            }
            .foregroundStyle(on ? scheme.onStrong : DS.Color.ink)
            .padding(.horizontal, DS.Space.space2).frame(maxWidth: .infinity, minHeight: DS.Space.hit)
            .background {
                if on { Capsule().fill(scheme.strongFill) }
                else { Capsule().fill(DS.Color.surface).shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2) }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(on ? "\(selected) selected" : "\(count)")")
        .accessibilityHint("Opens the filter")
    }
}

/// Value chip: off is a sunken pill, on is the strong fill. Used in the filter sheet, on Add and in the tag editor.
struct TagChip: View {
    let text: String
    var count: Int?
    var on = false
    var removable = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.Space.space1) {
                Text(text).lineLimit(1)
                if let count { Text("\(count)").font(T.caption).foregroundStyle(on ? scheme.onStrong : DS.Color.inkMuted) }
                if removable { Image(systemName: "xmark").font(T.caption.weight(.bold)) }
            }
            .font(T.subhead.weight(on ? .semibold : .medium))
            .foregroundStyle(on ? scheme.onStrong : DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 36)
            .background(Capsule().fill(on ? scheme.strongFill : DS.Color.surfaceSunken))
            .frame(minHeight: DS.Space.hit)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(removable ? "Remove \(text)" : text)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = DS.Space.space2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (i, p) in arrange(bounds.width, subviews).points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], size: CGSize) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.init(width: width.isFinite ? width : nil, height: nil))
            if x > 0 && x + sz.width > width { x = 0; y += row + spacing; row = 0 }
            points.append(CGPoint(x: x, y: y))
            x += sz.width + spacing
            row = max(row, sz.height)
            maxX = max(maxX, x - spacing)
        }
        return (points, CGSize(width: maxX, height: y + row))
    }
}

/// Read-only tag pills (accent-tint wash, ink text).
struct TagList: View {
    let tags: [String]

    var body: some View {
        FlowLayout(spacing: DS.Space.space1) {
            ForEach(tags, id: \.self) { t in
                Text(tagLabel(t)).font(T.caption.weight(.medium)).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, DS.Space.space2).padding(.vertical, DS.Space.space1)
                    .background(Capsule().fill(DS.Color.accentTint))
            }
        }
    }
}

struct CoverImage: View {
    let source: String?
    @EnvironmentObject var settings: Settings
    @State private var image: UIImage?

    private static let cache = NSCache<NSString, UIImage>()

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let url = CoverURL.resolve(source, baseURL: settings.serverURL, token: ""), source?.hasPrefix("/") != true {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { placeholder }
            } else {
                placeholder
            }
        }
        .task(id: source) { await load() }
    }

    private var placeholder: some View {
        ZStack {
            DS.Color.vinyl
            Circle().fill(DS.Color.accent).frame(width: 14, height: 14)
        }
    }

    /// Server covers are fetched with the auth header, never with a token in the URL.
    private func load() async {
        guard let source, source.hasPrefix("/") else { image = nil; return }
        if let hit = Self.cache.object(forKey: source as NSString) { image = hit; return }
        guard let data = try? await APIClient(baseURL: settings.serverURL, token: settings.token).fetch(source),
              let img = UIImage(data: data) else { return }
        Self.cache.setObject(img, forKey: source as NSString)
        image = img
    }
}

/// Song row: cover, title, artist, duration or "Downloading NN%", and a menu slot.
struct SongRow<Menu: View>: View {
    let title: String
    let subtitle: String
    let thumbnail: String?
    var duration: Double?
    var downloading: Double?
    var playing = false
    var coverSize: CGFloat = 56
    @ViewBuilder var menu: () -> Menu

    var body: some View {
        HStack(spacing: DS.Space.space3) {
            CoverImage(source: thumbnail)
                .frame(width: coverSize, height: coverSize)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2)
                Text(subtitle).font(T.body).foregroundStyle(playing ? DS.Color.ink : DS.Color.inkMuted).lineLimit(1)
            }
            Spacer(minLength: DS.Space.space1)
            if let downloading {
                Text("Downloading \(Int(downloading * 100))%").font(T.caption).foregroundStyle(DS.Color.accentInk)
                    .multilineTextAlignment(.trailing)
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
    init(title: String, subtitle: String, thumbnail: String?, duration: Double? = nil, downloading: Double? = nil,
         playing: Bool = false, coverSize: CGFloat = 56) {
        self.init(title: title, subtitle: subtitle, thumbnail: thumbnail, duration: duration, downloading: downloading,
                  playing: playing, coverSize: coverSize) { EmptyView() }
    }
}

struct TransportKeyStyle: ButtonStyle {
    enum Kind { case key, lit, ghost(on: Bool) }
    var kind: Kind

    func makeBody(configuration: Configuration) -> some View {
        let lit: Bool = { if case .lit = kind { return true }; return false }()
        let ghostOn: Bool = { if case .ghost(let on) = kind { return on }; return false }()
        let size = lit ? CGSize(width: 56, height: 48) : CGSize(width: 52, height: DS.Space.hit)
        return configuration.label
            .font(.system(size: lit ? 22 : 20))
            .foregroundStyle(lit ? DS.Color.onAccent : ghostOn ? DS.Color.accentInk : DS.Color.ink)
            .frame(width: size.width, height: size.height)
            .background {
                switch kind {
                case .lit:
                    RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.accent)
                        .shadow(color: DS.Color.accent.opacity(0.5), radius: 12)
                case .key:
                    RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceKey)
                        .shadow(color: DS.Color.vinyl.opacity(0.2), radius: 2, y: 1)
                case .ghost(let on):
                    RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous)
                        .fill(on ? DS.Color.accentTint : Color.clear)
                }
            }
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

/// Transport tray: shuffle, previous, lit play/pause, next, repeat.
struct TransportTray: View {
    let playing: Bool
    let shuffle: Bool
    let repeatMode: PlayerService.RepeatMode
    let onShuffle: () -> Void
    let onPrevious: () -> Void
    let onToggle: () -> Void
    let onNext: () -> Void
    let onRepeat: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.space2) {
            Button(action: onShuffle) { Image(systemName: "shuffle") }
                .buttonStyle(TransportKeyStyle(kind: .ghost(on: shuffle)))
                .accessibilityLabel("Shuffle").accessibilityValue(shuffle ? "on" : "off")
            Spacer(minLength: 0)
            Button(action: onPrevious) { Image(systemName: "backward.end.fill") }
                .buttonStyle(TransportKeyStyle(kind: .key)).accessibilityLabel("Previous song")
            Button(action: onToggle) { Image(systemName: playing ? "pause.fill" : "play.fill") }
                .buttonStyle(TransportKeyStyle(kind: .lit)).accessibilityLabel(playing ? "Pause" : "Play")
            Button(action: onNext) { Image(systemName: "forward.end.fill") }
                .buttonStyle(TransportKeyStyle(kind: .key)).accessibilityLabel("Next song")
            Spacer(minLength: 0)
            Button(action: onRepeat) { Image(systemName: repeatMode == .one ? "repeat.1" : "repeat") }
                .buttonStyle(TransportKeyStyle(kind: .ghost(on: repeatMode != .off)))
                .accessibilityLabel("Repeat").accessibilityValue(repeatMode == .off ? "off" : repeatMode == .all ? "whole list" : "one song")
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
        .dsSlab(radius: DS.Radius.radiusTray)
    }
}

/// A flat horizontal bar: sunken track, accent fill, round paper thumb. Draggable.
struct DSSlider: View {
    @Binding var value: Double
    var range: ClosedRange<Double> = 0...1
    var label: String
    var disabled = false
    var valueText: ((Double) -> String)?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { geo in
            let span = max(range.upperBound - range.lowerBound, 0.0001)
            let frac = min(1, max(0, (value - range.lowerBound) / span))
            let track = max(geo.size.width - 18, 1)
            let x = track * frac
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken).frame(height: 6)
                Capsule().fill(DS.Color.accent).frame(width: x + 9, height: 6)
                Circle().fill(scheme == .dark ? DS.Color.ink : DS.Color.surface).frame(width: 18, height: 18)
                    .shadow(color: DS.Color.vinyl.opacity(0.3), radius: 2, y: 1)
                    .offset(x: x)
            }
            .frame(height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                guard !disabled, geo.size.width > 0 else { return }
                value = range.lowerBound + span * min(1, max(0, (g.location.x - 9) / track))
            })
        }
        .frame(height: DS.Space.hit)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(valueText?(value) ?? "\(Int(((value - range.lowerBound) / max(range.upperBound - range.lowerBound, 0.0001)) * 100)) percent")
        .accessibilityAdjustableAction { dir in
            let step = (range.upperBound - range.lowerBound) * 0.05
            switch dir {
            case .increment: value = min(range.upperBound, value + step)
            case .decrement: value = max(range.lowerBound, value - step)
            @unknown default: break
            }
        }
    }
}

/// Port of web/js/tag-editor.js: chosen tags, suggestions, and the library's tags to pick from.
struct TagEditor: View {
    @Binding var tags: [String]
    @Binding var suggested: [String]
    let pool: [(tag: String, count: Int)]
    @Binding var input: String
    @State private var showPool = false

    private func has(_ t: String) -> Bool { tags.contains { $0.lowercased() == t.lowercased() } }
    private func toggle(_ t: String) {
        if has(t) { tags.removeAll { $0.lowercased() == t.lowercased() } } else { tags.append(t) }
    }

    private func commit() {
        let r = splitTagInput(input)
        for t in r.tags where !has(t) { tags.append(t) }
        input = r.rest
    }

    private var filtered: [TagGroup] {
        let q = input.trimmingCharacters(in: .whitespaces).lowercased()
        return tagGroups(pool.filter { q.isEmpty || $0.tag.lowercased().contains(q) || tagLabel($0.tag).lowercased().contains(q) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            TextField("Add a tag (plain or key:value)", text: $input)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(commit)
                .onChange(of: input) { _, v in if v.contains(",") { commit() } }
                .dsField()
            if !tags.isEmpty {
                FlowLayout {
                    ForEach(tags, id: \.self) { t in TagChip(text: tagLabel(t), on: true, removable: true) { toggle(t) } }
                }
            }
            let open = suggested.filter { !has($0) }
            if !open.isEmpty {
                SectionLabel("Suggested")
                FlowLayout { ForEach(open, id: \.self) { t in TagChip(text: tagLabel(t)) { toggle(t) } } }
            }
            if !pool.isEmpty {
                Button { showPool.toggle() } label: {
                    Label(showPool || !input.isEmpty ? "Hide library tags" : "Library tags",
                          systemImage: showPool || !input.isEmpty ? "chevron.up" : "chevron.down")
                        .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .frame(minHeight: DS.Space.hit)
                }
                .buttonStyle(.plain)
                if showPool || !input.isEmpty {
                    ForEach(filtered) { g in
                        SectionLabel(g.name)
                        FlowLayout {
                            ForEach(g.tags, id: \.tag) { t in
                                TagChip(text: tagLabel(t.tag), count: t.count, on: has(t.tag)) { toggle(t.tag) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Tags plus whatever is still typed in the tag field.
func finalTags(_ tags: [String], pending: String) -> [String] {
    var out = tags
    for t in splitTagInput(pending).tags where !out.contains(where: { $0.lowercased() == t.lowercased() }) { out.append(t) }
    return out
}

func formatTime(_ seconds: Double) -> String {
    let s = Int(max(seconds, 0))
    return String(format: "%d:%02d", s / 60, s % 60)
}
