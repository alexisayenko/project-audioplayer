import SwiftUI

struct LibraryFilterSheet: View {
    let category: LibraryFacet
    @Binding var selection: Set<String>
    let resultCount: () -> Int
    @EnvironmentObject private var query: LibraryQuery
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var listening: ListeningStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var values: [LibraryFacetValue]
    @State private var search = ""
    @State private var detent: PresentationDetent
    @State private var height: CGFloat = 0
    @State private var valuesHeight: CGFloat = 0
    @State private var contentOffset: CGFloat = 0
    @State private var tick = 0

    init(category: LibraryFacet, values: [LibraryFacetValue], selection: Binding<Set<String>>, resultCount: @escaping () -> Int) {
        self.category = category; _selection = selection; self.resultCount = resultCount
        // Freeze order at open; changing a selection never moves a chip under the finger.
        let ordered = category == .era ? values : values.sorted { a, b in
            if a.id == category.unknown { return false }
            if b.id == category.unknown { return true }
            let aSelected = selection.wrappedValue.contains(a.id), bSelected = selection.wrappedValue.contains(b.id)
            if aSelected != bSelected { return aSelected }
            return a.count == b.count ? LibraryMatching.compare(a.label, b.label) == .orderedAscending : a.count > b.count
        }
        _values = State(initialValue: ordered)
        _detent = State(initialValue: category == .tags ? .large : .medium)
    }
    private var selected: Int { selection.filter { $0.hasPrefix(category.prefix) }.count }
    private var visible: [LibraryFacetValue] {
        let q = LibraryMatching.folded(search)
        return q.isEmpty ? values : values.filter { LibraryMatching.folded($0.label).contains(q) }
    }
    private var detents: Set<PresentationDetent> {
        if typeSize.isAccessibilitySize { return [.large] }
        if category == .era { return [.height(max(height, DS.Component.detailsCover)), .large] }
        return [.medium, .large]
    }
    private var selectedDetent: Binding<PresentationDetent> {
        Binding(get: {
            if typeSize.isAccessibilitySize { return .large }
            if category == .era && detent != .large { return .height(max(height, DS.Component.detailsCover)) }
            return detent
        }, set: { detent = $0 })
    }

    var body: some View {
        VStack(spacing: DS.Space.space2) {
            VStack(spacing: DS.Space.space2) {
                HStack {
                    Text(category.rawValue).font(T.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button("Done") { dismiss() }.font(T.body.weight(.semibold)).foregroundStyle(DS.Color.selectInk)
                        .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                }
                ViewThatFits(in: .horizontal) {
                    HStack { meta; Spacer(); matchCount }
                    VStack(alignment: .leading, spacing: DS.Space.space1) { meta; matchCount }
                }
            }.padding(.horizontal, DS.Space.space4)
            LibraryHairline().opacity(contentOffset < 0 ? 1 : 0)
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.space3) {
                    Color.clear.frame(height: 0).background(GeometryReader { geometry in
                        Color.clear.preference(key: LibraryFilterOffset.self, value: geometry.frame(in: .named("filter.values")).minY)
                    })
                    if category != .era {
                        LibrarySearchField(text: $search, placeholder: "Search \(category.noun(2))", height: DS.Component.fieldHeight) {
                            detent = .large
                        }
                    }
                    if visible.isEmpty {
                        Text("Nothing here yet.").font(T.body).foregroundStyle(DS.Color.inkMuted)
                    } else if category == .era {
                        eraBlocks.measuredHeight($valuesHeight)
                    } else {
                        FlowLayout(spacing: DS.Space.space2) { ForEach(visible) { chip($0, wide: false) } }
                    }
                }
                .padding(.horizontal, DS.Space.space4).padding(.bottom, DS.Space.space4 + DS.Component.chipFade)
            }
            .frame(height: category == .era && !typeSize.isAccessibilitySize ? valuesHeight + DS.Space.space4 + DS.Space.space3 + DS.Component.chipFade : nil)
            .coordinateSpace(name: "filter.values").onPreferenceChange(LibraryFilterOffset.self) { contentOffset = $0 }
            .scrollDismissesKeyboard(.interactively).scrollBounceBehavior(.basedOnSize)
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [DS.Color.surface.opacity(0), DS.Color.surface], startPoint: .top, endPoint: .bottom)
                    .frame(height: DS.Component.chipFade).allowsHitTesting(false)
            }
        }
        .padding(.top, DS.Space.space6).measuredHeight($height)
        .background(DS.Color.surface).presentationBackground(DS.Color.surface)
        .presentationCornerRadius(DS.Radius.radiusTray).presentationDragIndicator(.visible)
        .presentationDetents(detents, selection: selectedDetent)
        .onAppear { if typeSize.isAccessibilitySize { detent = .large } }
        .onChange(of: typeSize) { _, value in if value.isAccessibilitySize { detent = .large } }
        .sensoryFeedback(.selection, trigger: tick).accessibilityAction(.escape) { dismiss() }
    }
    private var meta: some View {
        Text("\(values.count) \(category.noun(values.count)) · \(selected) selected").font(T.caption).foregroundStyle(DS.Color.inkMuted)
    }
    private var eraBlocks: some View {
        let grouped = Dictionary(grouping: visible.filter { eraYear($0) != nil }) { eraYear($0)! / 100 }
        let unknown = visible.filter { eraYear($0) == nil }
        return VStack(alignment: .leading, spacing: DS.Space.space4) {
            ForEach(grouped.keys.sorted(), id: \.self) { century in
                VStack(alignment: .leading, spacing: DS.Space.space2) {
                    Text("\(century)xx").font(T.subhead).underline().foregroundStyle(DS.Color.inkMuted)
                        .accessibilityAddTraits(.isHeader)
                    eraChips((grouped[century] ?? []).sorted { eraYear($0)! < eraYear($1)! })
                }
            }
            if !unknown.isEmpty { eraChips(unknown) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    @ViewBuilder private func eraChips(_ values: [LibraryFacetValue]) -> some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                ForEach(values) { chip($0, wide: false) }
            }
        } else {
            FlowLayout(spacing: DS.Space.space2) { ForEach(values) { chip($0, wide: false) } }
        }
    }
    private func eraYear(_ value: LibraryFacetValue) -> Int? {
        Int(value.id.dropFirst(category.prefix.count))
    }
    private func chipLabel(_ value: LibraryFacetValue) -> String {
        if category == .era, let year = eraYear(value) {
            return String(format: "the %02ds", (year % 100 + 100) % 100)
        }
        return value.label
    }
    private var matchCount: some View {
        // Observe query, library and listening so this is live while the sheet is presented.
        let _ = query.search
        let _ = library.songs
        let _ = listening.loaded
        let count = resultCount()
        return Text(count == 1 ? "1 song matches" : "\(count) songs match").font(T.caption)
            .foregroundStyle(DS.Color.inkMuted).monospacedDigit().accessibilityAddTraits(.updatesFrequently)
    }
    private func chip(_ value: LibraryFacetValue, wide: Bool) -> some View {
        let on = selection.contains(value.id)
        return Button {
            if on { selection.remove(value.id) } else { selection.insert(value.id) }
            tick += 1
        } label: {
            HStack(spacing: DS.Space.space1) {
                Text(chipLabel(value)).font(on ? T.subhead.weight(.semibold) : T.subhead)
                if wide { Spacer(minLength: DS.Space.space1) }
                Text("\(value.count)").font(T.caption).foregroundStyle(on ? scheme.onStrong : DS.Color.inkMuted)
            }
            .foregroundStyle(on ? scheme.onStrong : DS.Color.ink).padding(.horizontal, DS.Space.space3)
            .frame(minHeight: DS.Control.control)
            .background(Capsule().fill(on ? scheme.strongFill : DS.Color.surfaceSunken))
            .contentShape(Rectangle().inset(by: -DS.Space.space1))
        }
        .buttonStyle(LibraryPressStyle()).accessibilityLabel(voiceLabel(value))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
    private func voiceLabel(_ value: LibraryFacetValue) -> String {
        let name = category == .era && value.id != category.unknown ? String(value.id.dropFirst(category.prefix.count)) + "s" : value.label
        return "\(name), \(value.count) \(value.count == 1 ? "song" : "songs")"
    }
}

private struct LibraryFilterOffset: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
