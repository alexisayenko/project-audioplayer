import SwiftUI

/// Bottom sheet for one category: its values with counts, multi-select, one button that reports the result.
struct FilterSheet: View {
    let category: FilterCategory
    let values: [(tag: String, count: Int)]
    @Binding var selection: Set<String>
    let resultCount: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var chipsHeight: CGFloat = 0
    @State private var contentHeight: CGFloat = 0

    private var selectedHere: Int { values.filter { selection.contains($0.tag.lowercased()) }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space4) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(category.rawValue).font(T.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                    Text("\(values.count) in your library · \(selectedHere) selected").dsCaption()
                }
                Spacer()
                Button("Clear") { for v in values { selection.remove(v.tag.lowercased()) } }
                    .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                    .disabled(selectedHere == 0).opacity(selectedHere == 0 ? 0.5 : 1)
            }
            ScrollView {
                if values.isEmpty {
                    Text("Nothing here yet.").font(T.body).foregroundStyle(DS.Color.inkMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    FlowLayout {
                        ForEach(values, id: \.tag) { v in
                            let key = v.tag.lowercased()
                            TagChip(text: tagLabel(v.tag), count: v.count, on: selection.contains(key)) {
                                if selection.contains(key) { selection.remove(key) } else { selection.insert(key) }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .measuredHeight($chipsHeight)
                }
            }
            .frame(height: chipsHeight > 0 ? min(chipsHeight, 360) : nil)
            .scrollBounceBehavior(.basedOnSize)
            Button { dismiss() } label: {
                Text("Show \(resultCount) \(resultCount == 1 ? "song" : "songs")")
            }
            .buttonStyle(LitButtonStyle())
        }
        .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space6).padding(.bottom, DS.Space.space4)
        .measuredHeight($contentHeight)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DS.Color.surface.ignoresSafeArea())
        .presentationDetents([.height(contentHeight > 0 ? contentHeight + 12 : 240)])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(DS.Radius.radiusTray)
        .presentationBackground(DS.Color.surface)
    }
}

/// The one lit button of a sheet: accent fill, on-accent label, soft glow.
/// Disabled: accent-tint fill, ink-faint label, no glow.
struct LitButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(T.headline).foregroundStyle(enabled ? DS.Color.onAccent : DS.Color.inkFaint)
            .frame(maxWidth: .infinity, minHeight: 52).padding(.horizontal, DS.Space.space4)
            .background {
                if enabled { Capsule().fill(DS.Color.accent).shadow(color: DS.Color.accent.opacity(0.5), radius: 12) }
                else { Capsule().fill(DS.Color.accentTint) }
            }
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
