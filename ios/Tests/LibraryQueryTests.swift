import XCTest
@testable import AudioPlayer

@MainActor
final class LibraryQueryTests: XCTestCase {
    private func song(_ id: String, _ title: String = "Song", artist: String = "Artist", year: Int? = nil,
                      tags: [String] = [], bpm: Double? = nil, length: Double? = nil) -> Track {
        Track(id: id, title: title, artist: artist, duration: length, year: year, tags: tags, bpm: bpm)
    }
    private func query() -> LibraryQuery {
        let defaults = UserDefaults(suiteName: "LibraryQueryTests.\(UUID().uuidString)")!
        return LibraryQuery(defaults: defaults)
    }

    func testSearchFindsAccentsStructuredCreditsVersionsAndCountryNames() {
        let q = query()
        var track = song("a", "Café", tags: ["country:lt"])
        track.mainArtists = ["Main"]
        track.featuredArtists = ["Guest"]
        track.withArtists = ["Collaborator"]
        track.version = SongVersion(type: "remix", name: "Night Mix", artists: ["Producer"])
        track.albums = ["Collection"]
        for term in ["CAFE", "guest", "collaborator", "night mix", "producer", "collection", "Lithuania"] {
            q.search = term
            XCTAssertEqual(q.results([track], phoneIDs: [], listening: [:]).map(\.id), ["a"], term)
        }
    }

    func testSelectionsUseOrWithinFacetAndAndAcrossFacets() {
        let q = query()
        let songs = [song("a", year: 2024, tags: ["genre:house", "country:lt"]),
                     song("b", year: 2024, tags: ["genre:pop", "country:lt"]),
                     song("c", year: 2024, tags: ["genre:house", "country:se"])]
        q.selection = ["genre:house", "genre:pop", "country:lt", "era:2020"]
        XCTAssertEqual(Set(q.results(songs, phoneIDs: [], listening: [:]).map(\.id)), ["a", "b"])
        q.downloadedOnly = true
        XCTAssertEqual(q.results(songs, phoneIDs: ["b"], listening: [:]).map(\.id), ["b"])
    }

    func testEraComesFromDisplayedYearAndUnknownCombinesAsAnAlternative() {
        var version = song("v", year: 1980, tags: ["decade:80s"])
        version.version = SongVersion(type: "remix", releaseYear: 2024)
        let unknown = song("u")
        XCTAssertEqual(LibraryFacet.era.keys(version), ["era:2020"])
        XCTAssertEqual(LibraryFacet.era.values([version, unknown]).map(\.id), ["era:2020", "era:__unset__"])
        let q = query()
        q.selection = ["era:2020", "era:__unset__"]
        XCTAssertEqual(q.results([version, unknown], phoneIDs: [], listening: [:]).count, 2)
    }

    func testRemasterKeepsOriginalYearAndStructuredGenresAreFilterable() {
        var track = song("a", year: 1984)
        track.version = SongVersion(type: "remaster", releaseYear: 2024)
        track.genres = ["House"]
        XCTAssertEqual(track.libraryYear, 1984)
        XCTAssertEqual(LibraryFacet.genres.keys(track), ["genre:house"])
    }

    func testMissingSortValuesStayLastInBothDirectionsWithStableTies() {
        let q = query()
        let songs = [song("missing", "Alpha"), song("z", "Same", year: 2020, bpm: 120, length: 180),
                     song("a", "Same", year: 2020, bpm: 120, length: 180), song("early", "Early", year: 1990, bpm: 90, length: 100)]
        for sort in [LibrarySort.year, .bpm, .length] {
            q.choose(sort)
            for reversed in [false, true] {
                q.reversed = reversed
                let result = q.results(songs, phoneIDs: [], listening: [:]).map(\.id)
                XCTAssertEqual(result.last, "missing", "\(sort), \(reversed)")
                XCTAssertLessThan(result.firstIndex(of: "a")!, result.firstIndex(of: "z")!)
            }
        }
    }

    func testTitleArtistAndDirectionDefaults() {
        let q = query()
        let songs = [song("a", "Zulu", artist: "Éclair"), song("b", "Alpha", artist: "Beta"), song("c", "Missing", artist: "")]
        q.choose(.artist)
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: [:]).map(\.id), ["b", "a", "c"])
        q.reversed = true
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: [:]).map(\.id), ["a", "b", "c"])
        q.choose(.title)
        XCTAssertFalse(q.reversed)
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: [:]).map(\.id), ["b", "c", "a"])
    }

    func testListeningCountsSkippedSongsAsPreviouslyPlayedAndSortsDates() throws {
        let entries = try JSONDecoder().decode([String: LibraryListeningEntry].self, from: Data(#"{"a":{"listened":{"all":0},"skipped":{"all":1},"last_listened":null},"b":{"listened":{"all":3},"last_listened":"2026-10-22"},"c":{"listened":{"all":1},"last_listened":"2026-10-20"}}"#.utf8))
        let songs = [song("a"), song("b"), song("c"), song("d")]
        let q = query()
        q.neverListened = true
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: entries).map(\.id), ["d"])
        q.neverListened = false; q.choose(.listened)
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: entries).map(\.id), ["b", "c", "a", "d"])
        q.reversed = true
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: entries).map(\.id), ["c", "b", "a", "d"])
    }

    func testMemoizedResultsRunTheFilterOnceWhileNothingChanges() {
        let q = query()
        let songs = [song("a", "Beta"), song("b", "Alpha")]
        let stamp = LibraryQuery.DataStamp(phoneOnly: false, library: 1, listening: 1)
        let expected = q.results(songs, phoneIDs: [], listening: [:]).map(\.id)
        for _ in 0..<5 { XCTAssertEqual(q.results(songs, phoneIDs: [], listening: [:], stamp: stamp).map(\.id), expected) }
        XCTAssertEqual(q.computed, 1)
    }

    func testMemoizedResultsFollowTheQueryAndTheStamp() {
        let q = query()
        let songs = [song("a", "Beta"), song("b", "Alpha")]
        var stamp = LibraryQuery.DataStamp(phoneOnly: false, library: 1, listening: 1)
        _ = q.results(songs, phoneIDs: [], listening: [:], stamp: stamp)
        q.search = "alpha"
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: [:], stamp: stamp).map(\.id), ["b"])
        q.choose(.title); q.search = ""
        XCTAssertEqual(q.results(songs, phoneIDs: [], listening: [:], stamp: stamp).map(\.id), ["b", "a"])
        stamp.library = 2
        let more = songs + [song("c", "Aardvark")]
        XCTAssertEqual(q.results(more, phoneIDs: [], listening: [:], stamp: stamp).map(\.id), ["c", "b", "a"])
        XCTAssertEqual(q.computed, 4)
    }

    func testMemoizedResultsSkipReadingTheSongsWhenCached() {
        let q = query()
        let stamp = LibraryQuery.DataStamp(phoneOnly: true, library: 3, listening: 0)
        var reads = 0
        func songs() -> [Track] { reads += 1; return [song("a")] }
        _ = q.results(songs(), phoneIDs: [], listening: [:], stamp: stamp)
        _ = q.results(songs(), phoneIDs: [], listening: [:], stamp: stamp)
        XCTAssertEqual(reads, 1)
    }

    func testClearKeepsSortAndRelaunchRestoresOnlySort() {
        let defaults = UserDefaults(suiteName: "LibraryQueryTests.\(UUID().uuidString)")!
        let q = LibraryQuery(defaults: defaults)
        q.choose(.length); q.reversed = true; q.search = "hello"; q.selection = ["genre:house"]
        q.neverListened = true; q.downloadedOnly = true
        q.clear()
        XCTAssertFalse(q.narrowing); XCTAssertEqual(q.sort, .length); XCTAssertTrue(q.reversed)
        q.search = "temporary"
        let restored = LibraryQuery(defaults: defaults)
        XCTAssertEqual(restored.sort, .length); XCTAssertTrue(restored.reversed); XCTAssertFalse(restored.narrowing)
    }
}
