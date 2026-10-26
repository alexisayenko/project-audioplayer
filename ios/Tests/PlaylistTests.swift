import XCTest
@testable import AudioPlayer

final class PlaylistTests: XCTestCase {
    private func track(_ id: String, duration: Double? = nil) -> Track {
        Track(id: id, title: id, artist: "A", duration: duration)
    }

    func testDecodesListRow() throws {
        let json = #"{"playlists":[{"id":"pl_abc12345","name":"Night","description":"","count":3,"first_song_id":"s1","updated":"2026-10-26T10:00:00Z"}]}"#
        let list = try JSONDecoder().decode(PlaylistList.self, from: Data(json.utf8))
        XCTAssertEqual(list.playlists.count, 1)
        XCTAssertEqual(list.playlists[0].firstSongID, "s1")
        XCTAssertEqual(list.playlists[0].count, 3)
    }

    func testDecodesDetailAndToleratesMissingFields() throws {
        let detail = try JSONDecoder().decode(PlaylistDetail.self, from: Data(#"{"id":"pl_x","name":"Mix","songs":["a","b"]}"#.utf8))
        XCTAssertEqual(detail.songs, ["a", "b"])
        XCTAssertNil(detail.description)
        let empty = try JSONDecoder().decode(PlaylistDetail.self, from: Data(#"{"id":"pl_y"}"#.utf8))
        XCTAssertEqual(empty.songs, [])
        XCTAssertEqual(empty.summary.count, 0)
    }

    func testDecodesAddResult() throws {
        let result = try JSONDecoder().decode(PlaylistAddResult.self, from: Data(#"{"added":2,"skipped":["x"]}"#.utf8))
        XCTAssertEqual(result, PlaylistAddResult(added: 2, skipped: ["x"]))
    }

    func testCleanNameTrimsAndLimits() {
        XCTAssertEqual(PlaylistLogic.cleanName("  Night drive \n"), "Night drive")
        XCTAssertNil(PlaylistLogic.cleanName("   "))
        XCTAssertNil(PlaylistLogic.cleanName(String(repeating: "a", count: 121)))
        XCTAssertNotNil(PlaylistLogic.cleanName(String(repeating: "a", count: 120)))
        XCTAssertNil(PlaylistLogic.cleanName("bad\u{0007}name"))
    }

    func testSortedIgnoresCase() {
        let lists = [PlaylistSummary(id: "1", name: "beta"), PlaylistSummary(id: "2", name: "Alpha"), PlaylistSummary(id: "3", name: "Gamma")]
        XCTAssertEqual(PlaylistLogic.sorted(lists).map(\.name), ["Alpha", "beta", "Gamma"])
    }

    func testMovedFollowsOnMoveSemantics() {
        let ids = ["a", "b", "c", "d"]
        XCTAssertEqual(PlaylistLogic.moved(ids, from: IndexSet(integer: 0), to: 3), ["b", "c", "a", "d"])
        XCTAssertEqual(PlaylistLogic.moved(ids, from: IndexSet(integer: 3), to: 0), ["d", "a", "b", "c"])
        XCTAssertEqual(PlaylistLogic.moved(ids, from: IndexSet(integer: 1), to: 2), ids)
        XCTAssertEqual(PlaylistLogic.moved(ids, from: IndexSet(integer: 9), to: 0), ids)
    }

    func testMergedKeepsHiddenIDsInPlace() {
        let full = ["a", "x", "b", "c", "y"]
        XCTAssertEqual(PlaylistLogic.merged(full: full, shown: ["c", "a", "b"]), ["c", "x", "a", "b", "y"])
        XCTAssertEqual(PlaylistLogic.merged(full: full, shown: ["a", "b", "c"]), full)
    }

    func testTotalText() {
        XCTAssertEqual(PlaylistLogic.totalText([]), "0 songs")
        XCTAssertEqual(PlaylistLogic.totalText([track("a")]), "1 song")
        XCTAssertEqual(PlaylistLogic.totalText([track("a", duration: 1800), track("b", duration: 1200)]), "2 songs, 0:50 total")
        XCTAssertEqual(PlaylistLogic.totalText([track("a", duration: 3600), track("b")]), "2 songs, about 1:00 total")
    }

    func testNotes() {
        XCTAssertEqual(PlaylistLogic.queueNote(added: 3, already: 1, notOnPhone: 2), "Added 3 songs to the queue (1 already in queue, 2 not on this iPhone skipped)")
        XCTAssertEqual(PlaylistLogic.queueNote(added: 1, already: 0, notOnPhone: 0), "Added 1 song to the queue")
        XCTAssertEqual(PlaylistLogic.playNote(count: 4, notOnPhone: 0, shuffled: true, shuffleWasOn: false), "Playing 4 songs (shuffled)")
        XCTAssertEqual(PlaylistLogic.playNote(count: 1, notOnPhone: 2, shuffled: false, shuffleWasOn: true), "Playing 1 song (shuffle off), 2 not on this iPhone skipped")
        XCTAssertEqual(PlaylistLogic.addedNote(name: "Mix", result: PlaylistAddResult(added: 0, skipped: ["a"]), asked: 1), "Already in the playlist")
        XCTAssertEqual(PlaylistLogic.addedNote(name: "Mix", result: PlaylistAddResult(added: 1, skipped: []), asked: 1), "Added to Mix")
        XCTAssertEqual(PlaylistLogic.addedNote(name: "Mix", result: PlaylistAddResult(added: 2, skipped: ["a"]), asked: 3), "Added 2 songs to Mix, 1 already there")
    }

    func testPlayableKeepsOnlyPhoneSongsInOrder() {
        let entries = [SongListEntry.song(track("a")), .missing(number: 2, title: "x", duration: nil), .song(track("b")), .song(track("c"))]
        XCTAssertEqual(SongListLogic.playable(entries, phoneIDs: ["c", "a"]).map(\.id), ["a", "c"])
    }
}
