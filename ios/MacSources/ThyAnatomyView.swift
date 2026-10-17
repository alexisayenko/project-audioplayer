import SwiftUI

func thyToneColor(_ tone: String?) -> Color {
    switch tone {
    case "main": DS.Chart.chart0
    case "title": DS.Chart.chart6
    case "featured": DS.Chart.chart2
    case "version": DS.Chart.chart5
    case "original": DS.Chart.chart3
    default: DS.Color.inkFaint
    }
}

private struct ThySegFrames: PreferenceKey {
    static var defaultValue: [Int: CGRect] = [:]
    static func reduce(value: inout [Int: CGRect], nextValue: () -> [Int: CGRect]) { value.merge(nextValue()) { $1 } }
}

private let titleSpace = "thyTitle"

struct ThyAnatomyView: View {
    let data: Thy.Anatomy
    @Environment(\.colorScheme) private var scheme
    @State private var selected = 0
    @State private var hovered: [String]?
    @State private var legendOpen = false
    @State private var jsonOpen = false
    @FocusState private var focus: String?

    private var example: Thy.Example { data.examples[min(selected, data.examples.count - 1)] }
    private var fillColor: Color { scheme == .dark ? DS.Color.accent : DS.Color.accentStrong }

    private var active: [String]? {
        if let hovered { return hovered }
        guard let f = focus else { return nil }
        if f.hasPrefix("s"), let i = Int(f.dropFirst()), example.segments.indices.contains(i) { return example.segments[i].fields }
        if f.hasPrefix("r:") { return [String(f.dropFirst(2))] }
        return nil
    }

    private func segOn(_ s: Thy.Segment) -> Bool { active.map { ids in s.fields.contains { ids.contains($0) } } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space4) {
            examplesList
            titleCard
            panel("Legend", isOpen: $legendOpen) { legend }
            panel("How this song is stored", isOpen: $jsonOpen) { json }
        }
        .onChange(of: selected) { _, _ in hovered = nil; focus = nil }
    }

    private var examplesList: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 336), spacing: DS.Space.space3, alignment: .leading)], alignment: .leading, spacing: DS.Space.space1) {
            ForEach(Array(data.examples.enumerated()), id: \.offset) { i, e in
                ThyExampleRow(title: e.rawTitle, on: i == selected, rule: fillColor) { selected = i }
            }
        }
        .accessibilityElement(children: .contain).accessibilityLabel("Examples")
    }

    private var titleFont: Font { DS.Font.display }

    private var titleCard: some View {
        FlowLayout(spacing: 0) {
            ForEach(Array(example.segments.enumerated()), id: \.offset) { i, s in
                if s.fields.isEmpty {
                    Text(s.text.replacingOccurrences(of: " ", with: "\u{00A0}")).font(titleFont).foregroundStyle(DS.Color.ink)
                        .padding(.vertical, DS.Space.space1)
                } else {
                    segment(i, s)
                }
            }
        }
        .padding(.horizontal, DS.Space.space5).padding(.vertical, DS.Space.space4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous).fill(DS.Color.surface)
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2))
        .coordinateSpace(name: titleSpace)
        .overlayPreferenceValue(ThySegFrames.self) { frames in
            GeometryReader { g in
                ZStack(alignment: .topLeading) {
                    ForEach(Array(example.segments.enumerated()), id: \.offset) { i, s in
                        if segOn(s), let f = frames[i] {
                            ThyHint(text: Thy.label(of: s, in: data.fields), color: thyToneColor(Thy.tone(of: s, in: data.fields)), frame: f, cardWidth: g.size.width)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .allowsHitTesting(false)
        }
        .zIndex(1)
        .accessibilityElement(children: .contain)
    }

    private func segment(_ i: Int, _ s: Thy.Segment) -> some View {
        let color = thyToneColor(Thy.tone(of: s, in: data.fields))
        let on = segOn(s)
        return VStack(alignment: .leading, spacing: DS.Space.space1) {
            Text(s.text).font(titleFont).foregroundStyle(DS.Color.ink).fixedSize(horizontal: false, vertical: true)
            Rectangle().fill(color).frame(height: DS.Stroke.strokeFocus)
        }
        .padding(.horizontal, DS.Space.space1).padding(.vertical, DS.Space.space1)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusXs, style: .continuous).fill(on ? DS.Color.accentTint : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.radiusXs, style: .continuous).strokeBorder(on ? color : Color.clear, lineWidth: DS.Stroke.strokeFocus))
        .background(GeometryReader { p in Color.clear.preference(key: ThySegFrames.self, value: [i: p.frame(in: .named(titleSpace))]) })
        .contentShape(Rectangle())
        .onHover { inside in
            if inside { hovered = s.fields } else if hovered == s.fields { hovered = nil }
        }
        .focusable()
        .focused($focus, equals: "s\(i)")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(s.text), \(Thy.label(of: s, in: data.fields))")
    }

    private func panel<C: View>(_ title: String, isOpen: Binding<Bool>, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { isOpen.wrappedValue.toggle() } label: {
                HStack(spacing: DS.Space.space2) {
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .semibold)).foregroundStyle(DS.Color.inkMuted)
                        .rotationEffect(.degrees(isOpen.wrappedValue ? 0 : -90))
                    Text(title).font(DS.Font.headline).foregroundStyle(DS.Color.ink)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, DS.Space.space4)
                .frame(minHeight: DS.Space.hit)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen.wrappedValue ? "expanded" : "collapsed")
            if isOpen.wrappedValue {
                content().padding(.horizontal, DS.Space.space4).padding(.bottom, DS.Space.space4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous).fill(DS.Color.surface)
            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2))
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack(alignment: .top, spacing: 0) {
                Text("Field").frame(maxWidth: .infinity, alignment: .leading)
                Text("Value").frame(maxWidth: .infinity, alignment: .leading)
                Text("Meaning").frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            .padding(.horizontal, DS.Space.space3)
            ForEach(Thy.rows(for: example, fields: data.fields)) { r in legendRow(r) }
        }
    }

    private func legendRow(_ r: Thy.Row) -> some View {
        let color = thyToneColor(r.field.tone)
        let on = active?.contains(r.id) ?? false
        return HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(r.field.path).font(DS.Font.time).foregroundStyle(DS.Color.ink)
                Text(r.field.label).font(DS.Font.caption).foregroundStyle(DS.Color.inkMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(Thy.formatValue(r.value)).font(DS.Font.subhead).foregroundStyle(DS.Color.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(r.field.description).font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .textSelection(.enabled)
        .padding(.vertical, DS.Space.space2).padding(.horizontal, DS.Space.space3)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(on ? DS.Color.accentTint : DS.Color.surface))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: DS.Radius.radiusSm, bottomLeadingRadius: DS.Radius.radiusSm)
                .fill(color).frame(width: DS.Space.space1)
        }
        .contentShape(Rectangle())
        .onHover { inside in
            if inside { hovered = [r.id] } else if hovered == [r.id] { hovered = nil }
        }
        .focusable()
        .focused($focus, equals: "r:\(r.id)")
    }

    private var json: some View {
        ScrollView(.horizontal) {
            Text(example.song.stringified()).font(DS.Font.time).foregroundStyle(DS.Color.ink)
                .textSelection(.enabled).fixedSize()
                .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusKey, style: .continuous).fill(DS.Color.surfaceSunken))
        .accessibilityLabel("Stored song as JSON")
    }
}

private struct ThyExampleRow: View {
    let title: String
    let on: Bool
    let rule: Color
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(title).font(DS.Font.body).foregroundStyle(on ? DS.Color.ink : DS.Color.inkMuted)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(on ? DS.Color.accentTint : (hover ? DS.Color.surfaceKey : Color.clear)))
                .overlay(alignment: .leading) {
                    if on { UnevenRoundedRectangle(topLeadingRadius: DS.Radius.radiusSm, bottomLeadingRadius: DS.Radius.radiusSm).fill(rule).frame(width: DS.Stroke.strokeFocus) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct ThyHint: View {
    let text: String
    let color: Color
    let frame: CGRect
    let cardWidth: CGFloat
    @State private var width: CGFloat = 0

    var body: some View {
        Text(text).font(DS.Font.caption).foregroundStyle(DS.Color.ink).lineLimit(1).fixedSize()
            .padding(.horizontal, DS.Space.space2).padding(.vertical, DS.Space.space1)
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(DS.Color.surface))
            .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(color.opacity(0.16)))
            .overlay(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).strokeBorder(color, lineWidth: DS.Stroke.strokeHairline))
            .shadow(color: DS.Color.vinyl.opacity(0.25), radius: 12, y: 8)
            .background(GeometryReader { p in
                Color.clear.onAppear { width = p.size.width }.onChange(of: p.size.width) { _, w in width = w }
            })
            .offset(x: min(max(frame.minX, 0), max(0, cardWidth - width)), y: frame.maxY + DS.Space.space2)
            .accessibilityHidden(true)
    }
}
