import Foundation

private func matches(_ pattern: String, _ text: String) -> [String]? {
    guard let rx = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
          let m = rx.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
    return (0..<m.numberOfRanges).map { i in
        Range(m.range(at: i), in: text).map { String(text[$0]) } ?? ""
    }
}

private let youtubePatterns = [
    #"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$"#,
    #"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})(?:[/?#].*)?$"#,
    #"^(?:https?://)?youtu\.be/([A-Za-z0-9_-]{11})(?:[/?#].*)?$"#,
]
private let trackingParams: Set<String> = ["si", "feature", "pp", "fbclid", "gclid"]

/// Port of web/js/url-clean.js.
func cleanUrl(_ input: String) -> String {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if matches(#"^[A-Za-z0-9_-]{11}$"#, text) != nil { return "https://www.youtube.com/watch?v=\(text)" }
    for p in youtubePatterns {
        if let m = matches(p, text) { return "https://www.youtube.com/watch?v=\(m[1])" }
    }
    guard var comps = URLComponents(string: text), let scheme = comps.scheme?.lowercased(),
          scheme == "http" || scheme == "https", comps.percentEncodedQuery?.isEmpty == false else { return text }
    let kept = (comps.percentEncodedQueryItems ?? []).filter {
        let k = $0.name.lowercased()
        return !trackingParams.contains(k) && !k.hasPrefix("utm_")
    }
    comps.percentEncodedQueryItems = kept.isEmpty ? nil : kept
    return comps.string ?? text
}

func cleanPasted(_ input: String) -> String {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if let m = matches(#"(?:https?://|(?:www\.|m\.|music\.)?youtu(?:\.be|be\.com)/)[^\s<>"']+"#, text) {
        return cleanUrl(m[0])
    }
    let first = text.components(separatedBy: .newlines).first ?? text
    return cleanUrl(first)
}

func isWikiLink(_ v: String) -> Bool {
    matches(#"^https://(?:[a-z0-9-]+\.)+wikipedia\.org/wiki/\S+$"#, v) != nil
        || matches(#"^https://(?:www\.|m\.)?wikidata\.org/wiki/Q[1-9]\d*$"#, v) != nil
}

func splitTag(_ tag: String) -> (key: String, value: String) {
    guard let i = tag.firstIndex(of: ":"), i != tag.startIndex else { return ("", tag) }
    return (String(tag[..<i]), String(tag[tag.index(after: i)...]))
}

func decadeTag(_ year: Int?) -> String? {
    guard let y = year, (1950...2029).contains(y) else { return nil }
    return String(format: "decade:%02ds", y % 100 - y % 10)
}

func withDecade(_ tags: [String], _ year: Int?) -> [String] {
    guard let derived = decadeTag(year) else { return tags }
    var out: [String] = []
    var placed = false
    for t in tags {
        if t.lowercased().hasPrefix("decade:") {
            if !placed { out.append(derived) }
            placed = true
        } else { out.append(t) }
    }
    return placed ? out : out + [derived]
}

func decadeRank(_ tag: String) -> Int {
    guard let n = Int(splitTag(tag).value.prefix(2)) else { return 999 }
    return n < 50 ? n + 100 : n
}

func completeTag(_ raw: String) -> String {
    let t = raw.trimmingCharacters(in: .whitespaces)
    guard !t.isEmpty else { return "" }
    guard let i = t.firstIndex(of: ":") else { return t }
    let k = t[..<i].trimmingCharacters(in: .whitespaces)
    let v = t[t.index(after: i)...].trimmingCharacters(in: .whitespaces)
    return !k.isEmpty && !v.isEmpty ? t : ""
}

/// Splits comma-separated input into finished tags and the unfinished remainder (web/js/tag-input.js).
func splitTagInput(_ raw: String) -> (tags: [String], rest: String) {
    let parts = raw.split(separator: ",", omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    return (parts.map(completeTag).filter { !$0.isEmpty }, parts.filter { completeTag($0).isEmpty }.joined(separator: ", "))
}

struct TagGroup: Identifiable {
    let key: String
    let name: String
    let tags: [(tag: String, count: Int)]
    var id: String { key }
}

func tagGroups(_ counts: [(tag: String, count: Int)]) -> [TagGroup] {
    let names = ["decade": "Decade", "country": "Country", "lang": "Language"]
    let first = ["genre", "decade", "country", "lang"]
    var groups: [String: [(tag: String, count: Int)]] = [:]
    for c in counts { groups[splitTag(c.tag).key, default: []].append(c) }
    func rank(_ k: String) -> Int { k.isEmpty ? 2 : first.contains(k) ? 0 : 1 }
    let order = groups.keys.sorted {
        rank($0) != rank($1) ? rank($0) < rank($1)
            : rank($0) == 0 ? first.firstIndex(of: $0)! < first.firstIndex(of: $1)! : $0 < $1
    }
    return order.map { key in
        let name = key.isEmpty ? "Tags" : names[key] ?? key.prefix(1).uppercased() + key.dropFirst()
        let sorted = groups[key]!.sorted {
            key == "decade"
                ? decadeRank($0.tag) != decadeRank($1.tag) ? decadeRank($0.tag) < decadeRank($1.tag) : $0.tag < $1.tag
                : tagLabel($0.tag).localizedCompare(tagLabel($1.tag)) == .orderedAscending
        }
        return TagGroup(key: key, name: name, tags: sorted)
    }
}

func tagCounts(_ songTags: [[String]]) -> [(tag: String, count: Int)] {
    var map: [String: (tag: String, count: Int)] = [:]
    for tags in songTags {
        for t in tags {
            let k = t.lowercased()
            map[k] = (map[k]?.tag ?? t, (map[k]?.count ?? 0) + 1)
        }
    }
    return map.values.sorted { $0.tag < $1.tag }
}

func tagLabel(_ tag: String) -> String {
    let (key, value) = splitTag(tag)
    guard !key.isEmpty else { return tag }
    switch key {
    case "decade": return "the \(value)"
    case "country": return Locale(identifier: "en").localizedString(forRegionCode: value.uppercased()) ?? value
    case "lang": return Locale(identifier: "en").localizedString(forLanguageCode: value) ?? value
    default: return value
    }
}
