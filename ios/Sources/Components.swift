import SwiftUI

/// Dynamic Type counterparts of the DS.Font roles, generated from the design system (DS.Dynamic).
enum T {
    static let display = DS.Dynamic.display
    static let title = DS.Dynamic.title
    static let headline = DS.Dynamic.headline
    static let body = DS.Dynamic.body
    static let subhead = DS.Dynamic.subhead
    static let caption = DS.Dynamic.caption
    static let time = DS.Dynamic.time
}

extension ColorScheme {
    /// Fill for primary buttons and selected chips. Night uses the lit accent: white on accent-strong is 3.4:1, on-accent on accent is 8.5:1.
    var strongFill: Color { self == .dark ? DS.Color.accent : DS.Color.accentStrong }
    /// Label on `strongFill`: ink by day (4.8:1), on-accent by night (8.5:1).
    var onStrong: Color { self == .dark ? DS.Color.onAccent : DS.Color.ink }
    /// Fill of a progress or level bar: `strongFill`, or `accentInk` (4.7:1 on the ground by day) when Increase Contrast is on, because 3:1 is needed for a UI part.
    func progressFill(_ contrast: ColorSchemeContrast) -> Color { contrast == .increased ? DS.Color.accentInk : strongFill }
}

extension ColorSchemeContrast {
    /// Outline of an outlined pill: the hairline `line` (1.3:1), or `inkMuted` with Increase Contrast.
    var outline: Color { self == .increased ? DS.Color.inkMuted : DS.Color.line }
}

private struct ContrastEdge<S: InsettableShape>: ViewModifier {
    let shape: S
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content.overlay {
            if contrast == .increased { shape.strokeBorder(DS.Color.inkMuted, lineWidth: DS.Stroke.strokeHairline) }
        }
    }
}

extension View {
    /// A flat glass slab: surface, soft ambient shadow, no border.
    func dsSlab(radius: CGFloat = DS.Radius.radiusCard, fill: Color = DS.Color.surface) -> some View {
        background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill)
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2)
            .dsEdge(RoundedRectangle(cornerRadius: radius, style: .continuous)))
    }

    /// A floating slab (mini player, tab bar, transport tray): stronger lift and a 1px line ring (`shadow-float`).
    func dsFloat(radius: CGFloat = DS.Radius.radiusTray) -> some View { modifier(FloatSlab(radius: radius)) }

    /// With Increase Contrast, a 1pt `inkMuted` outline (4.5:1 on ground and surface): cards, fields and tracks otherwise sit at about 1.1:1 and rely on a shadow.
    func dsEdge<S: InsettableShape>(_ shape: S) -> some View { modifier(ContrastEdge(shape: shape)) }

    func dsGround() -> some View { background(DS.Color.ground.ignoresSafeArea()) }

    func dsField() -> some View {
        font(T.subhead).foregroundStyle(DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 40)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceSunken)
                .dsEdge(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous)))
    }

    func dsCaption() -> some View { font(T.caption).foregroundStyle(DS.Color.inkMuted) }
}

/// Placeholder text of a field: ink-muted (4.6:1 on the sunken field), never the system's fainter grey.
func dsPrompt(_ text: String) -> Text { Text(text).foregroundStyle(DS.Color.inkMuted) }

struct DSTextField: View {
    let label: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var plainURL = false

    var body: some View {
        TextField(label, text: $text, prompt: dsPrompt(label)).keyboardType(keyboard)
            .textInputAutocapitalization(plainURL ? .never : nil).autocorrectionDisabled(plainURL)
            .dsField()
    }
}

private struct FloatSlab: ViewModifier {
    let radius: CGFloat
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(DS.Color.surface)
                .shadow(color: DS.Color.vinyl.opacity(scheme == .dark ? 0.7 : 0.16), radius: 12, y: 8))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(contrast == .increased ? DS.Color.inkMuted : DS.Color.line, lineWidth: 1))
    }
}

struct ScreenHeader<Trailing: View>: View {
    let title: String
    var align: VerticalAlignment = .center
    var oneLine = false
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: align, spacing: DS.Space.space1) {
            MenuButton()
            Text(title).font(T.display).foregroundStyle(DS.Color.ink).lineLimit(oneLine ? 1 : 2).minimumScaleFactor(oneLine ? 0.5 : 0.7)
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
    @Environment(\.dynamicTypeSize) private var typeSize

    private func opacity(pressed: Bool) -> Double {
        if !enabled { return 0.4 }
        return pressed ? 0.7 : 1
    }

    func makeBody(configuration: Configuration) -> some View {
        let label = configuration.label
            .font(T.subhead.weight(.semibold))
            .lineLimit(typeSize.isAccessibilitySize ? 3 : 2).multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, DS.Space.space4)
            .padding(.vertical, typeSize.isAccessibilitySize ? DS.Space.space3 : 0)
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
                else { Capsule().fill(DS.Color.surface).shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2).dsEdge(Capsule()) }
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
            .background(Capsule().fill(on ? scheme.strongFill : DS.Color.surfaceSunken).dsEdge(Capsule()))
            .contentShape(Rectangle().inset(by: -4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(removable ? "Remove \(text)" : text)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct FlowFillKey: LayoutValueKey {
    static let defaultValue: CGFloat? = nil
}

extension View {
    /// In a `FlowLayout`: take the rest of the line (at least `minWidth`), else wrap and take the whole line.
    func flowFill(minWidth: CGFloat) -> some View { layoutValue(key: FlowFillKey.self, value: minWidth) }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = DS.Space.space2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        arrange(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        let a = arrange(bounds.width, subviews)
        for (i, p) in a.points.enumerated() {
            let fill = subviews[i][FlowFillKey.self] != nil
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y),
                              proposal: fill ? ProposedViewSize(width: a.widths[i], height: nil) : .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], widths: [CGFloat], size: CGSize) {
        var points: [CGPoint] = []
        var widths: [CGFloat] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var row: CGFloat = 0
        var maxX: CGFloat = 0
        for s in subviews {
            var sz = s.sizeThatFits(.init(width: width.isFinite ? width : nil, height: nil))
            if let minW = s[FlowFillKey.self] {
                if x > 0 && x + minW > width { x = 0; y += row + spacing; row = 0 }
                sz.width = width.isFinite ? max(minW, width - x) : minW
            } else if x > 0 && x + sz.width > width { x = 0; y += row + spacing; row = 0 }
            points.append(CGPoint(x: x, y: y))
            widths.append(sz.width)
            x += sz.width + spacing
            row = max(row, sz.height)
            maxX = max(maxX, x - spacing)
        }
        return (points, widths, CGSize(width: maxX, height: y + row))
    }
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

/// The 48 x 28 switch: accent-strong track when on, sunken track when off, round paper thumb.
struct DSSwitchStyle: ToggleStyle {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            Capsule().fill(configuration.isOn ? DS.Color.accentStrong : DS.Color.surfaceSunken)
                .overlay(Capsule().strokeBorder(contrast == .increased ? DS.Color.inkMuted : .clear, lineWidth: DS.Stroke.strokeThin))
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

/// The "Downloaded N" toggle beside the sort control: an outlined pill, tinted when on.
struct ToggleChip: View {
    let title: String
    let count: Int
    let on: Bool
    let action: () -> Void
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).font(T.caption.weight(.medium)).foregroundStyle(on ? DS.Color.accentInk : DS.Color.ink)
                Text("\(count)").font(T.caption).foregroundStyle(on ? DS.Color.accentInk : DS.Color.inkMuted)
            }
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
            .background(Capsule().fill(on ? DS.Color.accentTint : Color.clear))
            .overlay(Capsule().stroke(on ? DS.Color.accentInk : contrast.outline, lineWidth: 1.5))
            .contentShape(Capsule().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(count) songs")
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    }
}
