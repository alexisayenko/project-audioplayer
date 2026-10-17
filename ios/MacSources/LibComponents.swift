import AppKit
import SwiftUI

/// The few names the shared iOS `TokenField.swift` and `SongFormState.swift` expect from `Components.swift`, which is iOS-only.
enum T {
    static let display = Font.largeTitle.bold()
    static let title = Font.title2.bold()
    static let headline = Font.headline
    static let body = Font.body
    static let subhead = Font.subheadline
    static let caption = Font.footnote
    static let time = Font.footnote.monospaced().weight(.medium)
}

struct FlowFillKey: LayoutValueKey {
    static let defaultValue: CGFloat? = nil
}

extension View {
    func flowFill(minWidth: CGFloat) -> some View { layoutValue(key: FlowFillKey.self, value: minWidth) }

    func dsField() -> some View {
        font(T.subhead).foregroundStyle(DS.Color.ink).textFieldStyle(.plain)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 36)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceSunken))
    }

    func dsCaption() -> some View { font(T.caption).foregroundStyle(DS.Color.inkMuted) }
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

/// Needed by `SongFormState`; identical to the iOS helpers in `Components.swift`.
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

func finalTags(_ tags: [String], pending: String) -> [String] {
    var out = tags
    for t in splitTagInput(pending).tags where !out.contains(where: { $0.lowercased() == t.lowercased() }) { out.append(t) }
    return out
}

func libWikiDisplay(_ url: String) -> String {
    guard let r = url.range(of: #"^https?://(m\.)?en\.wikipedia\.org/wiki/(.+)$"#, options: [.regularExpression, .caseInsensitive]),
          let slash = url[r].range(of: "/wiki/", options: .caseInsensitive) else { return url }
    var title = String(url[slash.upperBound...])
    if let cut = title.firstIndex(where: { $0 == "#" || $0 == "?" }) { title = String(title[..<cut]) }
    guard !title.isEmpty else { return url }
    return (title.removingPercentEncoding ?? title).replacingOccurrences(of: "_", with: " ")
}

func libWikiNormalize(_ text: String) -> String {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return "" }
    if t.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil { return t }
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "()',.:!*~-_")
    let name = t.replacingOccurrences(of: " ", with: "_").addingPercentEncoding(withAllowedCharacters: allowed) ?? t
    return "https://en.wikipedia.org/wiki/" + name
}

/// Square cover with the copper rim; a missing or failed cover shows the vinyl placeholder. Server covers load with the auth header.
struct LibCover: View {
    let source: String?
    var radius: CGFloat = DS.Radius.radiusSm
    @EnvironmentObject var settings: Settings
    @State private var image: NSImage?
    @ObservedObject private var ui = LibraryUIState.shared

    private static let cache = NSCache<NSString, NSImage>()

    static func evict(_ id: String) { cache.removeObject(forKey: (Endpoints.coversPrefix + id) as NSString) }

    var body: some View {
        ZStack {
            placeholder
            if let image {
                Image(nsImage: image).resizable().scaledToFill()
            } else if let url = remote {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(DS.Color.copper, lineWidth: 1))
        .task(id: "\(source ?? "")#\(ui.coverRev[source ?? ""] ?? 0)") { await load() }
    }

    private var remote: URL? {
        guard let source, !source.hasPrefix("/") else { return nil }
        return CoverURL.resolve(source, baseURL: settings.serverURL, token: "")
    }

    private var placeholder: some View {
        GeometryReader { g in
            ZStack {
                DS.Color.vinyl
                Circle().fill(DS.Color.accent).frame(width: g.size.width * 0.4, height: g.size.width * 0.4)
            }
        }
    }

    private func load() async {
        guard let source, source.hasPrefix("/") else { image = nil; return }
        if let hit = Self.cache.object(forKey: source as NSString) { image = hit; return }
        image = nil
        guard let data = try? await APIClient(baseURL: settings.serverURL, token: settings.token).fetch(source),
              let img = NSImage(data: data) else { return }
        Self.cache.setObject(img, forKey: source as NSString)
        image = img
    }
}

/// Accent-filled capsule with the soft glow: the one primary action of a view.
struct LibLitButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(T.subhead.weight(.semibold))
            .foregroundStyle(enabled ? DS.Color.onAccent : DS.Color.inkFaint)
            .padding(.horizontal, DS.Space.space4).frame(minHeight: 36)
            .background {
                if enabled { Capsule().fill(DS.Color.accent).shadow(color: DS.Color.accent.opacity(0.5), radius: 10) }
                else { Capsule().fill(DS.Color.accentTint) }
            }
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(Capsule())
    }
}

struct LibOutlineButtonStyle: ButtonStyle {
    var danger = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(T.subhead.weight(.semibold))
            .foregroundStyle(danger ? DS.Color.powerText : DS.Color.accentInk)
            .padding(.horizontal, DS.Space.space4).frame(minHeight: 36)
            .overlay(Capsule().stroke(danger ? DS.Color.power : DS.Color.accentInk, lineWidth: 1.5))
            .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
            .contentShape(Capsule())
    }
}

/// Round 36 pt icon button for actions on a song's metadata.
struct LibRoundButtonStyle: ButtonStyle {
    var on = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 14, weight: .semibold))
            .foregroundStyle(on ? DS.Color.onAccent : DS.Color.accentInk)
            .frame(width: 36, height: 36)
            .background(Circle().fill(on ? DS.Color.accent : DS.Color.surfaceSunken))
            .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
            .contentShape(Circle())
    }
}

/// Value chip: off is a sunken pill, on is the strong fill.
struct LibChip: View {
    let text: String
    var count: Int?
    var on = false
    var removable = false
    var italic = false
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(text).italic(italic).lineLimit(1)
                if let count { Text("\(count)").font(T.caption.weight(.medium)).foregroundStyle(on ? onStrong : DS.Color.inkMuted) }
                if removable { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)) }
            }
            .font(T.subhead.weight(on ? .semibold : .medium))
            .foregroundStyle(on ? onStrong : DS.Color.ink)
            .padding(.horizontal, 14).frame(minHeight: 32)
            .background(Capsule().fill(on ? strong : DS.Color.surfaceSunken))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(removable ? "Remove \(text)" : text)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var strong: Color { scheme == .dark ? DS.Color.accent : DS.Color.accentStrong }
    private var onStrong: Color { scheme == .dark ? DS.Color.onAccent : DS.Color.ink }
}

/// Tag on a song: accent-tint pill, optional remove glyph.
struct LibTagPill: View {
    let text: String
    var removable = false
    var action: (() -> Void)?

    var body: some View {
        let label = HStack(spacing: 6) {
            Text(text).lineLimit(1)
            if removable { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(DS.Color.accentInk) }
        }
        .font(T.subhead.weight(.medium)).foregroundStyle(DS.Color.ink)
        .padding(.horizontal, DS.Space.space3).frame(minHeight: 28)
        .background(Capsule().fill(DS.Color.accentTint))
        if let action {
            Button(action: action) { label.contentShape(Capsule()) }.buttonStyle(.plain).accessibilityLabel("Remove \(text)")
        } else {
            label
        }
    }
}

struct LibPageHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Text("ELECTROPHONE").font(DS.Font.eyebrow).tracking(DS.Font.eyebrowTracking).foregroundStyle(DS.Color.inkMuted)
                Text(title).font(DS.Font.display).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                if let subtitle { Text(subtitle).dsCaption() }
            }
            Spacer(minLength: DS.Space.space2)
            trailing()
        }
    }
}

struct LibCard<Content: View>: View {
    var title: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            if let title { Text(title).font(DS.Font.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader) }
            content()
        }
        .padding(DS.Space.space4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous).fill(DS.Color.surface)
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2))
    }
}

private struct LibToastModifier: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let message {
                Text(message).font(T.subhead).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space2)
                    .background(Capsule().fill(DS.Color.surface).shadow(color: DS.Color.vinyl.opacity(0.3), radius: 12, y: 6))
                    .overlay(Capsule().strokeBorder(DS.Color.line, lineWidth: 1))
                    .padding(.bottom, DS.Space.space4)
                    .transition(.opacity)
                    .accessibilityAddTraits(.updatesFrequently)
                    .task(id: message) {
                        try? await Task.sleep(for: .seconds(3))
                        withAnimation { self.message = nil }
                    }
            }
        }
        .animation(.easeOut(duration: 0.2), value: message)
    }
}

extension View {
    func libToast(_ message: Binding<String?>) -> some View { modifier(LibToastModifier(message: message)) }
}
