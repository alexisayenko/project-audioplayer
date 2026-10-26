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

private let soundcloudHosts: Set<String> = ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]
private let soundcloudReservedUsers: Set<String> = [
    "discover", "stations", "you", "charts", "search", "upload", "feed", "pages", "popular",
    "mobile", "settings", "notifications", "messages", "jobs", "terms-of-use", "creators", "go",
]
private let soundcloudReservedSecond: Set<String> = [
    "tracks", "albums", "sets", "reposts", "likes", "spotlight", "comments", "popular-tracks",
    "following", "followers", "playlists",
]

enum SoundcloudLink: Equatable {
    case track(String), short(String), unsupported
}

/// Port of `classify_soundcloud` in server/app/urlclean.py; nil when the text is not a SoundCloud link.
func classifySoundcloud(_ input: String) -> SoundcloudLink? {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let m = matches(#"^(?:https?://)?([A-Za-z0-9.-]+)(/[^?#]*)?(?:[?#].*)?$"#, text) else { return nil }
    let host = m[1].lowercased()
    let parts = m[2].split(separator: "/").map(String.init)
    if host == "on.soundcloud.com" {
        if parts.count == 1, matches(#"^[A-Za-z0-9]{3,32}$"#, parts[0]) != nil {
            return .short("https://on.soundcloud.com/\(parts[0])")
        }
        return .unsupported
    }
    guard soundcloudHosts.contains(host) else { return nil }
    guard parts.count == 2 || parts.count == 3 else { return .unsupported }
    let name = #"^[A-Za-z0-9_-]+$"#
    guard !soundcloudReservedUsers.contains(parts[0].lowercased()),
          !soundcloudReservedSecond.contains(parts[1].lowercased()),
          matches(name, parts[0]) != nil, matches(name, parts[1]) != nil else { return .unsupported }
    var url = "https://soundcloud.com/\(parts[0])/\(parts[1])"
    if parts.count == 3 {
        guard matches(#"^s-[A-Za-z0-9]+$"#, parts[2]) != nil else { return .unsupported }
        url += "/\(parts[2])"
    }
    return .track(url)
}

/// The source named by a song id: `soundcloud-<id>`, `spotify-<id>`, `applemusic-<id>`, `shazam-<id>`, else "youtube".
func sourceOf(id: String) -> String {
    if matches(#"^soundcloud-[0-9]{1,20}$"#, id) != nil { return "soundcloud" }
    for s in ["spotify", "applemusic", "shazam"] where id.hasPrefix(s + "-") { return s }
    return "youtube"
}

func sourceLabel(_ source: String?) -> String {
    switch source {
    case "soundcloud": return "SoundCloud"
    case "spotify": return "Spotify"
    case "applemusic": return "Apple Music"
    case "shazam": return "Shazam"
    default: return "YouTube"
    }
}

extension Track {
    var source: String { sourceOf(id: id) }
}

/// Port of web/js/url-clean.js.
func cleanUrl(_ input: String) -> String {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if matches(#"^[A-Za-z0-9_-]{11}$"#, text) != nil { return "https://www.youtube.com/watch?v=\(text)" }
    for p in youtubePatterns {
        if let m = matches(p, text) { return "https://www.youtube.com/watch?v=\(m[1])" }
    }
    switch classifySoundcloud(text) {
    case .track(let url), .short(let url): return url
    default: break
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
    if let m = matches(#"(?:https?://|(?:www\.|m\.|music\.)?youtu(?:\.be|be\.com)/|(?:www\.|m\.)?soundcloud\.com/|on\.soundcloud\.com/)[^\s<>"']+"#, text) {
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

/// The year a song is shown with and its decade follows: its version's year when the version has one, else the release year (as the server does).
func displayYear(_ year: Int?, versionYear: Int?) -> Int? { versionYear ?? year }

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
    let counts = counts.filter { splitTag($0.tag).key.lowercased() != "lang" }
    let names = ["decade": "Decade", "country": "Country"]
    let first = ["genre", "decade", "country"]
    var groups: [String: [(tag: String, count: Int)]] = [:]
    for c in counts { groups[splitTag(c.tag).key, default: []].append(c) }
    func rank(_ k: String) -> Int {
        if k.isEmpty { return 2 }
        return first.contains(k) ? 0 : 1
    }
    let order = groups.keys.sorted {
        if rank($0) != rank($1) { return rank($0) < rank($1) }
        if rank($0) == 0 { return first.firstIndex(of: $0)! < first.firstIndex(of: $1)! }
        return $0 < $1
    }
    return order.map { key in
        let name = key.isEmpty ? "Tags" : names[key] ?? key.prefix(1).uppercased() + key.dropFirst()
        let sorted = groups[key]!.sorted {
            if key != "decade" { return tagLabel($0.tag).localizedCompare(tagLabel($1.tag)) == .orderedAscending }
            if decadeRank($0.tag) != decadeRank($1.tag) { return decadeRank($0.tag) < decadeRank($1.tag) }
            return $0.tag < $1.tag
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

func tagKey(_ tag: String) -> String { splitTag(tag).key.lowercased() }

let genreCap = 12
let countryCap = 1

/// ISO alpha-2 code for a typed country name or code; nil when unknown.
func countryCode(_ raw: String) -> String? {
    let t = raw.trimmingCharacters(in: .whitespaces)
    guard !t.isEmpty else { return nil }
    let en = Locale(identifier: "en")
    let codes = Locale.Region.isoRegions.map(\.identifier).filter { $0.count == 2 }
    if t.count == 2, codes.contains(t.uppercased()) { return t.lowercased() }
    return codes.first { en.localizedString(forRegionCode: $0)?.caseInsensitiveCompare(t) == .orderedSame }?.lowercased()
}

func hasTag(_ tags: [String], _ tag: String) -> Bool { tags.contains { $0.lowercased() == tag.lowercased() } }

/// Adds `genre:`/`country:` tags within the caps, skipping duplicates; returns how many were added.
@discardableResult
func addNamespaced(_ tags: inout [String], _ candidates: [String]) -> Int {
    var added = 0
    for t in candidates {
        let k = tagKey(t)
        guard k == "genre" || k == "country", !hasTag(tags, t) else { continue }
        let have = tags.filter { tagKey($0) == k }.count
        guard have < (k == "genre" ? genreCap : countryCap) else { continue }
        tags.append(t.lowercased()); added += 1
    }
    return added
}

private func canonicalSoundcloud(_ text: String) -> String? {
    guard case .track(let u)? = classifySoundcloud(text) else { return nil }
    return u.lowercased()
}

/// The library song a pasted link points at, found without the network: YouTube by video id, SoundCloud by canonical URL.
func libraryMatch(link: String, in songs: [Track]) -> Track? {
    let text = cleanPasted(link)
    guard !text.isEmpty else { return nil }
    for p in youtubePatterns {
        if let m = matches(p, text) {
            let vid = m[1]
            return songs.first { s in s.id == vid || (s.sources ?? []).contains { $0.source == "youtube" && $0.id == vid } }
        }
    }
    guard let want = canonicalSoundcloud(text) else { return nil }
    return songs.first { s in
        ([s.sourceURL] + (s.sources ?? []).map(\.url)).contains { $0.flatMap(canonicalSoundcloud) == want }
    }
}
