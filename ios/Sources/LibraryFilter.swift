import SwiftUI

/// The four category chips on Library. Plain tags and `lang:` fold into Tags.
enum FilterCategory: String, CaseIterable, Identifiable {
    case tags = "Tags", genres = "Genres", years = "Years", countries = "Countries"
    var id: String { rawValue }

    func owns(_ tag: String) -> Bool {
        let key = splitTag(tag).key.lowercased()
        switch self {
        case .genres: return key == "genre"
        case .years: return key == "decade"
        case .countries: return key == "country"
        case .tags: return !["genre", "decade", "country"].contains(key)
        }
    }

    func values(_ counts: [(tag: String, count: Int)]) -> [(tag: String, count: Int)] {
        let mine = counts.filter { owns($0.tag) }
        if self == .years {
            return mine.sorted { decadeRank($0.tag) != decadeRank($1.tag) ? decadeRank($0.tag) < decadeRank($1.tag) : $0.tag < $1.tag }
        }
        return mine.sorted { tagLabel($0.tag).localizedCaseInsensitiveCompare(tagLabel($1.tag)) == .orderedAscending }
    }
}

/// Values inside a category are alternatives; categories narrow each other.
func tagFilterMatches(_ track: Track, selection: Set<String>) -> Bool {
    guard !selection.isEmpty else { return true }
    let tags = Set((track.tags ?? []).map { $0.lowercased() })
    for category in FilterCategory.allCases {
        let picked = selection.filter { category.owns($0) }
        if !picked.isEmpty && tags.isDisjoint(with: picked) { return false }
    }
    return true
}

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
struct LitButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(T.headline).foregroundStyle(DS.Color.onAccent)
            .frame(maxWidth: .infinity, minHeight: 52).padding(.horizontal, DS.Space.space4)
            .background(Capsule().fill(DS.Color.accent).shadow(color: DS.Color.accent.opacity(0.5), radius: 12))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
