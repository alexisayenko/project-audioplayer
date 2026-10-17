import SwiftUI

/// One category's values with counts, multi-select, and one button that reports the live result.
struct LibFilterSheet: View {
    let category: FilterCategory
    let values: [(tag: String, count: Int)]
    let unsetCount: Int
    @Binding var selection: Set<String>
    let resultCount: Int
    @Environment(\.dismiss) private var dismiss

    private var unset: String? { unsetCount > 0 ? category.unsetToken : nil }
    private var selectedHere: Int { selection.filter { category.owns($0) }.count }

    private func toggle(_ key: String) {
        if selection.contains(key) { selection.remove(key) } else { selection.insert(key) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space4) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(category.rawValue).font(DS.Font.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                    Text("\(values.count) in your library \u{00B7} \(selectedHere) selected").dsCaption()
                }
                Spacer()
                Button("Clear") { selection = selection.filter { !category.owns($0) } }
                    .buttonStyle(.plain).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .disabled(selectedHere == 0).opacity(selectedHere == 0 ? 0.5 : 1)
            }
            ScrollView {
                if values.isEmpty && unset == nil {
                    Text("Nothing here yet.").font(T.body).foregroundStyle(DS.Color.inkMuted).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    FlowLayout {
                        if let unset {
                            LibChip(text: category.unsetLabel, count: unsetCount, on: selection.contains(unset), italic: true) { toggle(unset) }
                        }
                        ForEach(values, id: \.tag) { v in
                            LibChip(text: tagLabel(v.tag), count: v.count, on: selection.contains(v.tag.lowercased())) { toggle(v.tag.lowercased()) }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxHeight: 360)
            Button { dismiss() } label: {
                Text("Show \(resultCount) \(resultCount == 1 ? "song" : "songs")").frame(maxWidth: .infinity)
            }
            .buttonStyle(LibLitButtonStyle())
            .keyboardShortcut(.defaultAction)
            Button("Close") { dismiss() }.keyboardShortcut(.cancelAction).frame(width: 0, height: 0).opacity(0)
        }
        .padding(DS.Space.space5)
        .frame(width: 420)
        .background(DS.Color.surface)
    }
}
