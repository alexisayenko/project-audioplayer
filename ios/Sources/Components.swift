import SwiftUI

/// Dynamic Type counterparts of the DS.Font roles (same roles, same default sizes, but scalable).
enum T {
    static let display = Font.largeTitle.bold()
    static let title = Font.title2.bold()
    static let headline = Font.headline
    static let body = Font.body
    static let subhead = Font.subheadline
    static let caption = Font.footnote
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

    /// A floating slab (mini player, tab bar, transport tray): stronger lift and a 1px line ring (`shadow-float`).
    func dsFloat(radius: CGFloat = DS.Radius.radiusTray) -> some View { modifier(FloatSlab(radius: radius)) }

    func dsGround() -> some View { background(DS.Color.ground.ignoresSafeArea()) }

    func dsField() -> some View {
        font(T.subhead).foregroundStyle(DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 40)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceSunken))
    }

    func dsCaption() -> some View { font(T.caption).foregroundStyle(DS.Color.inkMuted) }
}

struct DSTextField: View {
    let label: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var plainURL = false
    var clearable = false
    @FocusState private var focused: Bool

    var body: some View {
        TextField(label, text: $text).keyboardType(keyboard)
            .textInputAutocapitalization(plainURL ? .never : nil).autocorrectionDisabled(plainURL)
            .focused($focused)
            .padding(.trailing, clearable ? DS.Space.hit - DS.Space.space3 : 0)
            .dsField()
            .overlay(alignment: .trailing) {
                if clearable && !text.isEmpty {
                    Button { text = ""; focused = true } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(DS.Color.inkFaint)
                            .frame(width: DS.Space.hit, height: DS.Space.hit)
                    }
                    .buttonStyle(.plain).accessibilityLabel("Clear \(label)")
                }
            }
    }
}

private struct FloatSlab: ViewModifier {
    let radius: CGFloat
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(DS.Color.surface)
                .shadow(color: DS.Color.vinyl.opacity(scheme == .dark ? 0.7 : 0.16), radius: 12, y: 8))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(DS.Color.line, lineWidth: 1))
    }
}

struct ScreenHeader<Trailing: View>: View {
    let title: String
    var align: VerticalAlignment = .center
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: align) {
            Text(title).font(T.display).foregroundStyle(DS.Color.ink).lineLimit(2).minimumScaleFactor(0.7)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: DS.Space.space2)
            trailing()
        }
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String) { self.init(title: title) { EmptyView() } }
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

enum DSButtonKind { case outline, quiet, danger }

struct DSButtonStyle: ButtonStyle {
    var kind: DSButtonKind
    @Environment(\.isEnabled) private var enabled

    private func opacity(pressed: Bool) -> Double {
        if !enabled { return 0.4 }
        return pressed ? 0.7 : 1
    }

    func makeBody(configuration: Configuration) -> some View {
        let label = configuration.label
            .font(T.subhead.weight(.semibold))
            .lineLimit(2).multilineTextAlignment(.center)
            .padding(.horizontal, DS.Space.space4)
            .frame(minHeight: kind == .danger ? 40 : DS.Space.hit)
        return Group {
            switch kind {
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
        .frame(minHeight: DS.Space.hit)
        .contentShape(Capsule())
        .opacity(opacity(pressed: configuration.isPressed))
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
                Text(title).font(T.subhead.weight(on ? .semibold : .medium)).lineLimit(1).minimumScaleFactor(0.85)
                Text("\(on ? selected : count)").font(T.caption)
                    .foregroundStyle(on ? scheme.onStrong : DS.Color.inkMuted)
            }
            .foregroundStyle(on ? scheme.onStrong : DS.Color.ink)
            .padding(.horizontal, 6).frame(maxWidth: .infinity, minHeight: 36)
            .background {
                if on { Capsule().fill(scheme.strongFill) }
                else { Capsule().fill(DS.Color.surface).shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2) }
            }
            .contentShape(Rectangle().inset(by: -4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(on ? "\(selected) selected" : "\(count)")")
        .accessibilityHint("Opens the filter")
    }
}

/// Value chip: off is a sunken pill, on is the strong fill. Used in the filter sheet and the tag pickers.
struct TagChip: View {
    let text: String
    var count: Int?
    var on = false
    var removable = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(text).lineLimit(1)
                if let count { Text("\(count)").font(T.caption.weight(.medium)).foregroundStyle(on ? scheme.onStrong : DS.Color.inkMuted) }
                if removable { Image(systemName: "xmark").font(T.caption.weight(.bold)) }
            }
            .font(T.subhead.weight(on ? .semibold : .medium))
            .foregroundStyle(on ? scheme.onStrong : DS.Color.ink)
            .padding(.horizontal, 14).frame(minHeight: 36)
            .background(Capsule().fill(on ? scheme.strongFill : DS.Color.surfaceSunken))
            .contentShape(Rectangle().inset(by: -4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(removable ? "Remove \(text)" : text)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Tag on a song (Add sheet, song sheet): accent-tint pill, ink label, optional remove glyph.
struct TagPill: View {
    let text: String
    var removable = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(text).lineLimit(1)
                if removable { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(DS.Color.accentInk) }
            }
            .font(T.subhead.weight(.medium)).foregroundStyle(DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
            .background(Capsule().fill(DS.Color.accentTint))
            .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(text)")
    }
}

/// The outlined round "+" that opens the tag editor.
struct AddTagButton: View {
    var open: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: open ? "chevron.up" : "plus").font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DS.Color.accentInk)
                .frame(width: 32, height: 32).overlay(Circle().stroke(DS.Color.line, lineWidth: 1.5))
                .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(open ? "Hide tag editor" : "Add tag")
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = DS.Space.space2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        arrange(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        for (i, p) in arrange(bounds.width, subviews).points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], size: CGSize) {
        var points: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var row: CGFloat = 0
        var maxX: CGFloat = 0
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
        GeometryReader { g in
            ZStack {
                DS.Color.vinyl
                Circle().fill(DS.Color.accent).frame(width: g.size.width * 0.4, height: g.size.width * 0.4)
                    .position(x: g.size.width / 2, y: g.size.height * (g.size.width > 150 ? 0.42 : 0.5))
            }
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

struct TransportKeyStyle: ButtonStyle {
    enum Kind { case key, lit, ghost(on: Bool) }
    var kind: Kind

    private var foreground: Color {
        switch kind {
        case .lit: return DS.Color.onAccent
        case .ghost(let on): return on ? DS.Color.accentInk : DS.Color.inkMuted
        case .key: return DS.Color.ink
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        let lit: Bool = { if case .lit = kind { return true }; return false }()
        let ghost: Bool = { if case .ghost = kind { return true }; return false }()
        let size = lit ? CGSize(width: 64, height: 48) : CGSize(width: ghost ? DS.Space.hit : 56, height: DS.Space.hit)
        return configuration.label
            .font(.system(size: lit ? 22 : 20))
            .foregroundStyle(foreground)
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
        HStack(spacing: 0) {
            Button(action: onShuffle) { Image(systemName: "shuffle") }
                .buttonStyle(TransportKeyStyle(kind: .ghost(on: shuffle)))
                .accessibilityLabel("Shuffle").accessibilityValue(shuffle ? "on" : "off")
            Spacer(minLength: DS.Space.space2)
            Button(action: onPrevious) { Image(systemName: "backward.end.fill") }
                .buttonStyle(TransportKeyStyle(kind: .key)).accessibilityLabel("Previous song")
            Spacer(minLength: DS.Space.space2)
            Button(action: onToggle) { Image(systemName: playing ? "pause.fill" : "play.fill") }
                .buttonStyle(TransportKeyStyle(kind: .lit)).accessibilityLabel(playing ? "Pause" : "Play")
            Spacer(minLength: DS.Space.space2)
            Button(action: onNext) { Image(systemName: "forward.end.fill") }
                .buttonStyle(TransportKeyStyle(kind: .key)).accessibilityLabel("Next song")
            Spacer(minLength: DS.Space.space2)
            Button(action: onRepeat) { Image(systemName: repeatMode == .one ? "repeat.1" : "repeat") }
                .buttonStyle(TransportKeyStyle(kind: .ghost(on: repeatMode != .off)))
                .accessibilityLabel("Repeat").accessibilityValue(repeatMode.spokenName)
        }
        .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
        .dsFloat(radius: DS.Radius.radiusTray)
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
            let track = max(geo.size.width - 16, 1)
            let x = track * frac
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken).frame(height: 6)
                Capsule().fill(DS.Color.accent).frame(width: x + 8, height: 6)
                Circle().fill(scheme == .dark ? DS.Color.ink : DS.Color.surface).frame(width: 16, height: 16)
                    .shadow(color: DS.Color.vinyl.opacity(0.3), radius: 2, y: 1)
                    .offset(x: x)
            }
            .frame(height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                guard !disabled, geo.size.width > 0 else { return }
                value = range.lowerBound + span * min(1, max(0, (g.location.x - 8) / track))
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
    var hiddenKeys: Set<String> = ["lang"]
    @State private var showPool = false

    private func has(_ t: String) -> Bool { tags.contains { $0.lowercased() == t.lowercased() } }
    private func toggle(_ t: String) {
        if has(t) { tags.removeAll { $0.lowercased() == t.lowercased() } } else { tags.append(t) }
    }

    private func commit() {
        let r = splitTagInput(input)
        for t in r.tags where !has(t) && !hiddenKeys.contains(tagKey(t)) { tags.append(t) }
        input = r.rest
    }

    private var filtered: [TagGroup] {
        let q = input.trimmingCharacters(in: .whitespaces).lowercased()
        return tagGroups(pool.filter { !hiddenKeys.contains(tagKey($0.tag)) }.filter { q.isEmpty || $0.tag.lowercased().contains(q) || tagLabel($0.tag).lowercased().contains(q) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            TextField("Add a tag (plain or key:value)", text: $input)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(commit)
                .onChange(of: input) { _, v in if v.contains(",") { commit() } }
                .dsField()
            let shown = tags.filter { !hiddenKeys.contains(tagKey($0)) }
            if !shown.isEmpty {
                FlowLayout {
                    ForEach(shown, id: \.self) { t in TagChip(text: tagLabel(t), on: true, removable: true) { toggle(t) } }
                }
            }
            let open = suggested.filter { !has($0) && !hiddenKeys.contains(tagKey($0)) }
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

/// A chip field that is a view over one namespaced tag (`genre:`, `country:`), capped.
struct NamespaceField: View {
    let title: String
    let key: String
    let cap: Int
    @Binding var tags: [String]
    @Binding var input: String
    @State private var note: String?
    @FocusState private var focused: Bool

    private var mine: [String] { tags.filter { tagKey($0) == key } }
    private var placeholder: String { key == "country" ? "Add a country" : "Add a genre" }

    private func commit(final: Bool = true) {
        note = commitNamespaced(&tags, key: key, cap: cap, input: &input, final: final)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            if !mine.isEmpty {
                FlowLayout {
                    ForEach(mine, id: \.self) { t in
                        TagChip(text: tagLabel(t), on: true, removable: true) { tags.removeAll { $0 == t } }
                    }
                }
                .padding(.vertical, DS.Space.space1)
            }
            if mine.count < cap {
                TextField(placeholder, text: $input)
                    .textInputAutocapitalization(key == "country" ? .words : .never).autocorrectionDisabled()
                    .submitLabel(.done).onSubmit { commit() }
                    .focused($focused)
                    .onChange(of: input) { _, v in if v.contains(where: { $0 == "," || $0 == "/" }) { commit(final: false) } }
                    .onChange(of: focused) { _, f in if !f { commit() } }
                    .dsField()
            }
            if let note { Text(note).font(T.caption).foregroundStyle(DS.Color.inkMuted) }
        }
        .onDisappear { commit() }
    }
}

/// Splits `input` on commas and slashes into `key:` tags (genres lowercased, countries via `countryCode`), skipping duplicates and unknown countries; returns a note when something was refused. Unless `final`, the text after the last separator stays in `input`.
@discardableResult
func commitNamespaced(_ tags: inout [String], key: String, cap: Int, input: inout String, final: Bool = true) -> String? {
    var parts = input.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "," || $0 == "/" }).map { $0.trimmingCharacters(in: .whitespaces) }
    let rest = final ? "" : (parts.popLast() ?? "")
    var note: String?
    for raw in parts where !raw.isEmpty {
        let value: String? = key == "country" ? countryCode(raw) : raw.lowercased()
        guard let value else { note = "Unknown country"; continue }
        let tag = "\(key):\(value)"
        if hasTag(tags, tag) { continue }
        guard tags.filter({ tagKey($0) == key }).count < cap else { note = "Up to \(cap)"; break }
        tags.append(tag)
    }
    input = rest
    return note
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

/// The 44pt lit round button (accent fill, on-accent glyph, glow): the + in the Library header.
struct LitCircleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(DS.Color.onAccent)
            .frame(width: DS.Space.hit, height: DS.Space.hit)
            .background(Circle().fill(DS.Color.accent).shadow(color: DS.Color.accent.opacity(0.5), radius: 12))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// The server's status LED, shown in the Add sheet and on Settings (never on Library).
struct ServerStatus: View {
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var settings: Settings
    var compact = false

    var body: some View {
        Button { Task { await server.check(settings: settings) } } label: {
            HStack(spacing: DS.Space.space2) {
                if server.checking { ProgressView().controlSize(.small) }
                else { LED(color: color, glow: server.reachable != nil) }
                Text(text).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.ink)
            }
            .frame(minHeight: compact ? 28 : DS.Space.hit, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text).accessibilityHint("Checks the server again")
    }

    private var color: Color {
        switch server.reachable { case true: DS.Color.ok; case false: DS.Color.power; default: DS.Color.inkFaint }
    }

    private var text: String {
        if server.forbidden { return "Not allowed on this server" }
        switch server.reachable { case true: return "Server online"; case false: return "Server unavailable"; default: return "Server not set up" }
    }
}

private struct ContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

extension View {
    /// Reports this view's height, so a sheet can be sized to its content and stay put when the keyboard opens.
    func measuredHeight(_ height: Binding<CGFloat>) -> some View {
        background(GeometryReader { Color.clear.preference(key: ContentHeightKey.self, value: $0.size.height) })
            .onPreferenceChange(ContentHeightKey.self) { height.wrappedValue = $0 }
    }
}

/// A song's tags as removable pills with the "+" after them; the last pill and the "+" wrap together, so the "+" is never alone on a line.
struct TagFlow: View {
    let tags: [String]
    var removable = false
    var adding: Bool
    let onRemove: (String) -> Void
    let onAdd: () -> Void

    var body: some View {
        FlowLayout {
            ForEach(tags.dropLast(), id: \.self) { t in TagPill(text: tagLabel(t), removable: removable) { onRemove(t) } }
            HStack(spacing: DS.Space.space2) {
                if let last = tags.last { TagPill(text: tagLabel(last), removable: removable) { onRemove(last) } }
                AddTagButton(open: adding, action: onAdd)
            }
        }
    }
}

/// The 48 x 28 switch: accent-strong track when on, sunken track when off, round paper thumb.
struct DSSwitchStyle: ToggleStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            Capsule().fill(configuration.isOn ? DS.Color.accentStrong : DS.Color.surfaceSunken)
                .frame(width: 48, height: 28)
                .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                    Circle().fill(scheme == .dark ? DS.Color.ink : DS.Color.surface).frame(width: 24, height: 24).padding(2)
                        .shadow(color: DS.Color.vinyl.opacity(0.2), radius: 1, y: 1)
                }
                .animation(.easeOut(duration: 0.15), value: configuration.isOn)
                .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
}

extension ServerLink {
    var ledColor: Color {
        switch reachable {
        case .some(true): return DS.Color.ok
        case .some(false): return DS.Color.power
        case .none: return DS.Color.inkFaint
        }
    }
}

/// Just the LED of the server's state, for a collapsed row.
struct ServerLED: View {
    @EnvironmentObject var server: ServerLink

    var body: some View {
        LED(color: server.ledColor, glow: server.reachable != nil)
    }
}

/// The "Downloaded N" toggle beside the sort control: an outlined pill, tinted when on.
struct ToggleChip: View {
    let title: String
    let count: Int
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).font(T.caption.weight(.medium)).foregroundStyle(on ? DS.Color.accentInk : DS.Color.ink)
                Text("\(count)").font(T.caption).foregroundStyle(on ? DS.Color.accentInk : DS.Color.inkMuted)
            }
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
            .background(Capsule().fill(on ? DS.Color.accentTint : Color.clear))
            .overlay(Capsule().stroke(on ? DS.Color.accentInk : DS.Color.line, lineWidth: 1.5))
            .contentShape(Capsule().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(count) songs")
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    }
}
