import Foundation

let genreSuggestMax = 6

private func foldGenre(_ s: String) -> String {
    s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).trimmingCharacters(in: .whitespaces)
}

func suggestGenres(query: String, genres: [String], chosen: [String] = [], max: Int = genreSuggestMax) -> [String] {
    let q = foldGenre(query)
    guard !q.isEmpty else { return [] }
    var taken = Set(chosen.map(foldGenre))
    var starts: [String] = []
    var words: [String] = []
    var inside: [String] = []
    for g in genres {
        let f = foldGenre(g)
        guard !f.isEmpty, !taken.contains(f) else { continue }
        taken.insert(f)
        if f.hasPrefix(q) { starts.append(g) }
        else if f.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains(where: { $0.hasPrefix(q) }) { words.append(g) }
        else if f.contains(q) { inside.append(g) }
    }
    return Array((starts + words + inside).prefix(max))
}

func genresFromTags(_ tagLists: [[String]]) -> [String] {
    var counts: [String: Int] = [:]
    var order: [String] = []
    for tags in tagLists {
        for t in tags where t.lowercased().hasPrefix("genre:") {
            let v = String(t.dropFirst(6)).lowercased().trimmingCharacters(in: .whitespaces)
            guard !v.isEmpty else { continue }
            if counts[v] == nil { order.append(v) }
            counts[v, default: 0] += 1
        }
    }
    return order.enumerated().sorted { (counts[$0.element]!, $1.offset) > (counts[$1.element]!, $0.offset) }.map(\.element)
}

#if DEBUG
func genreSuggestSelfCheck() -> [String] {
    var fails: [String] = []
    func check(_ name: String, _ got: [String], _ want: [String]) { if got != want { fails.append("\(name): \(got) != \(want)") } }
    let all = ["synthpop", "pop", "k-pop", "pop rock", "indie pop", "rock"]
    check("order", suggestGenres(query: "pop", genres: all), ["pop", "pop rock", "k-pop", "indie pop", "synthpop"])
    check("exclude", suggestGenres(query: "pop", genres: all, chosen: ["Pop"]), ["pop rock", "k-pop", "indie pop", "synthpop"])
    check("accent", suggestGenres(query: "ELEC", genres: ["électro", "house"]), ["électro"])
    check("accentQuery", suggestGenres(query: "elec", genres: ["Électro"]), ["Électro"])
    check("cap", suggestGenres(query: "a", genres: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]).count == 6 ? [] : ["bad"], [])
    check("empty", suggestGenres(query: "  ", genres: all), [])
    check("none", suggestGenres(query: "zzz", genres: all), [])
    check("derive", genresFromTags([["genre:Rock", "x"], ["genre:pop"], ["genre:pop"]]), ["pop", "rock"])
    return fails
}
#endif
