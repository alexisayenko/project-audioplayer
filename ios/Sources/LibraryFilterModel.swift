import Foundation

/// The four category chips on Library. Plain tags fold into Tags; `lang:` tags are never shown.
enum FilterCategory: String, CaseIterable, Identifiable {
    case tags = "Tags", genres = "Genres", years = "Years", countries = "Countries"
    var id: String { rawValue }

    func owns(_ tag: String) -> Bool {
        let key = splitTag(tag).key.lowercased()
        switch self {
        case .genres: return key == "genre"
        case .years: return key == "decade"
        case .countries: return key == "country"
        case .tags: return !["genre", "decade", "country", "lang"].contains(key)
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
