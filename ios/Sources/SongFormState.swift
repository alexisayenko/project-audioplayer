import SwiftUI

/// The editable song fields shared by the Add form and the song edit screen, with Get metadata and the Wikipedia hint.
@MainActor
class SongFormState: ObservableObject {
    @Published var title = ""
    @Published var artist = ""
    @Published var album = ""
    @Published var remixer = ""
    @Published var year = "" { didSet { applyDecade() } }
    @Published var wikiSong = ""
    @Published var wikiArtist = ""
    @Published var musicbrainzURL = ""
    @Published var tags: [String] = []
    @Published var suggested: [String] = []
    @Published var pendingTag = ""
    @Published var pendingGenre = ""
    @Published var pendingCountry = ""
    @Published var metaBusy = false
    @Published var metaNote: String?
    @Published var services: [ServiceKind: URL?] = [:]
    @Published var suggest: MetadataResult.Suggest?

    init() {}

    convenience init(song: ServerSong) {
        self.init()
        title = song.title
        artist = song.artist ?? ""
        album = song.album ?? ""
        remixer = song.remixer ?? ""
        year = song.year.map(String.init) ?? ""
        wikiSong = song.wikipedia_song ?? ""
        wikiArtist = song.wikipedia_artist ?? ""
        musicbrainzURL = song.musicbrainz_url ?? ""
        services = storedServices
        tags = song.tags ?? []
    }

    var remixerValue: String? { let t = remixer.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
    var yearValue: Int? { Int(year.trimmingCharacters(in: .whitespaces)) }
    var wikiSongValue: String? { let t = wikiSong.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t }
    var wikiArtistValue: String? { let t = wikiArtist.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t }

    private static func differs(_ suggested: String?, _ current: String) -> String? {
        guard let s = suggested?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s.caseInsensitiveCompare(current.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame ? nil : s
    }

    /// The Wikipedia artist and title that still differ from the fields; nil when there is nothing to offer.
    var hint: (artist: String?, title: String?)? {
        let a = Self.differs(suggest?.artist, artist)
        let t = Self.differs(suggest?.title, title)
        return a == nil && t == nil ? nil : (a, t)
    }

    func applyHint() {
        guard let h = hint else { return }
        if let a = h.artist { artist = a }
        if let t = h.title { title = t }
        suggest = nil
    }

    private func applyDecade() {
        tags = withDecade(tags, yearValue)
        suggested = withDecade(suggested, yearValue)
    }

    /// The MusicBrainz link saved with the song keeps its icon lit until a lookup finds another one.
    private var storedServices: [ServiceKind: URL?] {
        guard let url = URL(string: musicbrainzURL), !musicbrainzURL.isEmpty else { return [:] }
        return [.musicbrainz: url]
    }

    var musicbrainzValue: String? { musicbrainzURL.isEmpty ? nil : musicbrainzURL }

    func resetMetadata() { suggest = nil; metaNote = nil; services = storedServices }

    func resetPending() { pendingTag = ""; pendingGenre = ""; pendingCountry = "" }

    /// Commits typed genre and country text, then returns the final tag list including a pending tag.
    func commitPending() -> [String] {
        commitNamespaced(&tags, key: "genre", cap: genreCap, input: &pendingGenre)
        commitNamespaced(&tags, key: "country", cap: countryCap, input: &pendingCountry)
        return finalTags(tags, pending: pendingTag)
    }

    private var lookups: [Task<Void, Never>] = []

    func launch(_ work: @escaping () async -> Void) { lookups.append(Task { await work() }) }

    func cancelLookups() { lookups.forEach { $0.cancel() }; lookups = [] }

    /// Fills only empty fields from the server's metadata; the Wikipedia hint and found services are kept for display.
    func getMetadata(api: APIClient, sources: [String]) async {
        guard !metaBusy else { return }
        metaBusy = true; metaNote = nil; services = storedServices; suggest = nil; defer { metaBusy = false }
        do {
            let r = try await api.metadata(title: title, artist: artist, sourceURLs: sources,
                                           wikiSong: wikiSong.trimmingCharacters(in: .whitespaces),
                                           wikiArtist: wikiArtist.trimmingCharacters(in: .whitespaces))
            var found: [ServiceKind: URL?] = [:]
            for (kind, svc) in [(ServiceKind.youtube, r.services?.youtube), (.soundcloud, r.services?.soundcloud), (.wikipedia, r.services?.wikipedia), (.musicbrainz, r.services?.musicbrainz)] where svc?.found == true {
                found[kind] = svc?.url.flatMap { URL(string: $0) }
            }
            if let mb = found[.musicbrainz] ?? nil { musicbrainzURL = mb.absoluteString }
            services = found.merging(storedServices) { _, stored in stored }
            suggest = r.suggest
            var changed = false
            let returned = !(r.album ?? "").isEmpty || r.year != nil || !(r.tags ?? []).isEmpty
            if let a = r.album, !a.isEmpty, album.trimmingCharacters(in: .whitespaces).isEmpty { album = a; changed = true }
            if let y = r.year, yearValue == nil { year = String(y); changed = true }
            if addNamespaced(&tags, r.tags ?? []) > 0 { changed = true }
            for t in r.tags ?? [] where ["genre", "country"].contains(tagKey(t)) && !hasTag(suggested, t) { suggested.append(t) }
            if changed { metaNote = nil } else if returned { metaNote = "Already up to date" } else { metaNote = "Nothing found" }
        } catch { metaNote = "Couldn't load metadata" }
    }
}
