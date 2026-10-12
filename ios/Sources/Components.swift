import SwiftUI

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

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
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > width { x = 0; y += row + spacing; row = 0 }
            points.append(CGPoint(x: x, y: y))
            x += sz.width + spacing
            row = max(row, sz.height)
            maxX = max(maxX, x - spacing)
        }
        return (points, CGSize(width: maxX, height: y + row))
    }
}

struct TagChip: View {
    let text: String
    var count: Int?
    var on = false
    var removable = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(text)
                if let count { Text("\(count)").font(.caption2).foregroundStyle(on ? Color.black.opacity(0.6) : Theme.labelDim) }
                if removable { Image(systemName: "xmark").font(.caption2.weight(.bold)) }
            }
            .font(.caption.smallCaps().weight(.semibold))
            .foregroundStyle(on ? Color.black : Theme.label)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(Capsule().fill(on ? Theme.cyan : Color(white: 0.16)))
            .overlay(Capsule().stroke(Theme.chromeEdge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(removable ? "Remove \(text)" : text)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct TagList: View {
    let tags: [String]

    var body: some View {
        FlowLayout(spacing: 5) {
            ForEach(tags, id: \.self) { t in
                Text(tagLabel(t)).font(.caption2.smallCaps().weight(.semibold))
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .foregroundStyle(Theme.label)
                    .background(Capsule().fill(Color.white.opacity(0.14)))
            }
        }
    }
}

struct CoverImage: View {
    let source: String?
    @EnvironmentObject var settings: Settings

    var body: some View {
        AsyncImage(url: CoverURL.resolve(source, baseURL: settings.serverURL, token: settings.token)) { image in
            image.resizable().scaledToFill()
        } placeholder: { Theme.panel }
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
        VStack(alignment: .leading, spacing: 10) {
            TextField("Add a tag (plain or key:value)", text: $input)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(commit)
                .onChange(of: input) { _, v in if v.contains(",") { commit() } }
            if !tags.isEmpty {
                FlowLayout {
                    ForEach(tags, id: \.self) { t in TagChip(text: tagLabel(t), on: true, removable: true) { toggle(t) } }
                }
            }
            let open = suggested.filter { !has($0) }
            if !open.isEmpty {
                Text("Suggested").panelLabel()
                FlowLayout { ForEach(open, id: \.self) { t in TagChip(text: tagLabel(t)) { toggle(t) } } }
            }
            if !pool.isEmpty {
                Button { showPool.toggle() } label: {
                    Label(showPool || !input.isEmpty ? "Hide library tags" : "Library tags",
                          systemImage: showPool || !input.isEmpty ? "chevron.up" : "chevron.down")
                        .font(.caption).foregroundStyle(Theme.cyan)
                }
                .buttonStyle(.plain)
                if showPool || !input.isEmpty {
                    ForEach(filtered) { g in
                        Text(g.name).panelLabel()
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
