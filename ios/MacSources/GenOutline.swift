import SwiftUI

/// The outline tree (GEN-016, GEN-046): family, genre (level 2), finer Wikidata sub-genres; selection and hover mirror the map.
struct GenOutline: View {
    @ObservedObject var model: GenModel

    var body: some View {
        let rows = model.graph?.outlineRows(expanded: model.expanded) ?? []
        let _ = model.rev
        VStack(spacing: 0) {
            HStack {
                Text("Outline").font(DS.Font.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                Button { model.setOutline(false) } label: { Image(systemName: "xmark") }
                    .buttonStyle(GenIconButtonStyle())
                    .help("Close outline").accessibilityLabel("Close outline")
            }
            .padding(.horizontal, DS.Space.space3).padding(.vertical, DS.Space.space2)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { r in
                            GenOutlineRowView(model: model, row: r, selected: r.id_ != nil && r.id_ == model.selectedID).id(r.key)
                        }
                    }
                    .padding(.horizontal, DS.Space.space3).padding(.bottom, DS.Space.space3)
                }
                .onChange(of: model.selectedID) { _, id in
                    guard let id, let key = rows.first(where: { $0.id_ == id })?.key else { return }
                    withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(key, anchor: nil) }
                }
            }
        }
        .frame(width: 360)
        .genCard()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Outline")
    }
}

private struct GenOutlineRowView: View {
    let model: GenModel
    let row: GenOutlineRow
    let selected: Bool

    var body: some View {
        let isFamily = row.kind == .family
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: DS.Space.space1) {
                Button { model.toggleExpanded(row.key) } label: {
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(row.expanded ? 0 : -90))
                        .foregroundStyle(DS.Color.inkMuted)
                        .frame(width: 28, height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(row.hasChildren ? 1 : 0)
                .disabled(!row.hasChildren)
                .accessibilityLabel("\(row.expanded ? "Collapse" : "Expand") \(row.label)")
                Button {
                    if isFamily { model.toggleExpanded(row.key) } else if let id = row.id_ { model.engine.select(id, center: true) }
                } label: {
                    HStack(spacing: DS.Space.space2) {
                        GenDot(family: row.family)
                        Text(row.label).font(T.subhead.weight(isFamily ? .semibold : .regular)).foregroundStyle(DS.Color.ink)
                            .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: DS.Space.space1)
                    }
                    .frame(minHeight: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                Text(trailing).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).padding(.trailing, DS.Space.space1)
            }
            if !row.alsoUnder.isEmpty {
                Text("also under \(row.alsoUnder.joined(separator: ", "))").font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted)
                    .padding(.leading, 28).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.leading, CGFloat(min(row.depth, 6)) * 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 32)
        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusSm, style: .continuous).fill(selected ? DS.Color.accentTint : Color.clear))
        .onHover { inside in
            if !isFamily, let id = row.id_ { model.engine.hoverID(inside ? id : nil) }
        }
    }

    private var trailing: String {
        if row.kind == .family {
            let n = row.size
            return row.unit == "genre" ? "\(n) \(n == 1 ? "genre" : "genres")" : "\(n) \(n == 1 ? "root" : "roots")"
        }
        return String(row.count ?? 0)
    }
}
