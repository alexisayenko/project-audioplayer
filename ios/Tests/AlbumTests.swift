import XCTest
@testable import AudioPlayer

final class AlbumTests: XCTestCase {
    private func album(title: String = "Tumult", artist: String? = "Derango", year: Int? = 2003, tracks: [AlbumTrack]) -> Album {
        Album(id: "alb_1", title: title, artist: artist, year: year, tracks: tracks)
    }

    private func song(_ id: String, duration: Double? = 240, onServer: Bool? = true) -> Track {
        Track(id: id, title: id, artist: "Derango", duration: duration, onServer: onServer)
    }

    func testDecodesAlbumRowAndToleratesGaps() throws {
        let json = #"""
        [{"id":"alb_a1b2c3d4","title":"Tumult","artist":"Derango","year":2003,"genres":["Psytrance"],"trackCount":2,
          "coverUrl":"/albums/alb_a1b2c3d4/cover?v=9","created_at":"2026-10-26T09:00:00Z",
          "tracks":[{"no":1,"title":"One","durationS":301,"songId":"s1"},{"no":2,"title":"Two","durationS":null,"songId":null}]},
         {"id":"alb_zz"}]
        """#
        let albums = try JSONDecoder().decode([Album].self, from: Data(json.utf8))
        XCTAssertEqual(albums.count, 2)
        XCTAssertEqual(albums[0].tracks.map(\.songId), ["s1", nil])
        XCTAssertEqual(albums[0].tracks[0].durationS, 301)
        XCTAssertNil(albums[0].tracks[1].durationS)
        XCTAssertEqual(albums[0].coverUrl, "/albums/alb_a1b2c3d4/cover?v=9")
        XCTAssertTrue(albums[1].tracks.isEmpty)
    }

    func testStatusIsCompleteOnlyWhenEveryTrackIsLinkedToALibrarySong() {
        let a = album(tracks: [AlbumTrack(no: 1, title: "One", songId: "s1"), AlbumTrack(no: 2, title: "Two", songId: "s2"), AlbumTrack(no: 3, title: "Three")])
        XCTAssertEqual(AlbumLogic.statusText(a, libraryIDs: ["s1", "s2"]), "In library 2 of 3")
        XCTAssertEqual(AlbumLogic.statusText(a, libraryIDs: ["s1"]), "In library 1 of 3")
        XCTAssertFalse(AlbumLogic.isComplete(a, libraryIDs: ["s1", "s2"]))
        let full = album(tracks: [AlbumTrack(no: 1, title: "One", songId: "s1"), AlbumTrack(no: 2, title: "Two", songId: "s2")])
        XCTAssertEqual(AlbumLogic.statusText(full, libraryIDs: ["s1", "s2"]), "In library 2 of 2")
        XCTAssertTrue(AlbumLogic.isComplete(full, libraryIDs: ["s1", "s2"]))
        XCTAssertEqual(AlbumLogic.statusText(album(tracks: []), libraryIDs: []), "No tracks")
        XCTAssertEqual(AlbumLogic.statusText(a, libraryIDs: [], ready: false), "3 tracks")
        XCTAssertFalse(AlbumLogic.isComplete(full, libraryIDs: ["s1", "s2"], ready: false))
    }

    func testPhoneText() {
        let a = album(tracks: [AlbumTrack(no: 1, title: "One", songId: "s1"), AlbumTrack(no: 2, title: "Two", songId: "s2"), AlbumTrack(no: 3, title: "Three")])
        XCTAssertEqual(AlbumLogic.phoneText(a, phoneIDs: ["s2", "other"]), "On phone 1 of 3")
        XCTAssertTrue(AlbumLogic.allLinkedOnPhone(a, libraryIDs: ["s1", "s2"], phoneIDs: ["s1", "s2"]))
        XCTAssertFalse(AlbumLogic.allLinkedOnPhone(a, libraryIDs: ["s1", "s2"], phoneIDs: ["s1"]))
        XCTAssertFalse(AlbumLogic.allLinkedOnPhone(album(tracks: []), libraryIDs: [], phoneIDs: []))
    }

    func testLengthTextMarksUnknownTracks() {
        XCTAssertEqual(AlbumLogic.formatTotalLength(45), "45 s")
        XCTAssertEqual(AlbumLogic.formatTotalLength(43 * 60), "43 min")
        XCTAssertEqual(AlbumLogic.formatTotalLength(3840), "1 h 04 min")
        let known = [AlbumTrack(no: 1, title: "a", durationS: 1800), AlbumTrack(no: 2, title: "b", durationS: 1800)]
        XCTAssertEqual(AlbumLogic.lengthText(known), "1 h 00 min")
        XCTAssertEqual(AlbumLogic.lengthText(known + [AlbumTrack(no: 3, title: "c")]), "~1 h 00 min")
        XCTAssertNil(AlbumLogic.lengthText([AlbumTrack(no: 1, title: "a")]))
        XCTAssertEqual(AlbumLogic.summary(album(tracks: known)), "2 tracks, 1 h 00 min")
        XCTAssertEqual(AlbumLogic.summary(album(tracks: [AlbumTrack(no: 1, title: "a")])), "1 track")
    }

    func testSearchFoldsCaseAndDiacriticsAndLooksInTracks() {
        let a = album(title: "Café Del Mar", tracks: [AlbumTrack(no: 1, title: "Sunset Strip")])
        XCTAssertTrue(AlbumLogic.matches(a, query: "cafe"))
        XCTAssertTrue(AlbumLogic.matches(a, query: "SUNSET"))
        XCTAssertTrue(AlbumLogic.matches(a, query: "derango"))
        XCTAssertFalse(AlbumLogic.matches(a, query: "missing"))
        XCTAssertTrue(AlbumLogic.matches(a, query: "  "))
    }

    func testSorts() {
        var a = album(title: "Beta", artist: "Zed", year: 1999, tracks: [AlbumTrack(no: 1, title: "x", durationS: 100)])
        a = Album(id: "a", title: a.title, artist: a.artist, year: a.year, tracks: a.tracks, created_at: "2026-01-01")
        let b = Album(id: "b", title: "alpha", artist: "Yan", year: nil, tracks: [], created_at: "2026-03-01")
        let c = Album(id: "c", title: "Gamma", artist: "Yan", year: 2010, tracks: [AlbumTrack(no: 1, title: "x"), AlbumTrack(no: 2, title: "y", durationS: 500)], created_at: "2026-02-01")
        let all = [a, b, c]
        XCTAssertEqual(AlbumLogic.sorted(all, by: .title, reversed: false).map(\.id), ["b", "a", "c"])
        XCTAssertEqual(AlbumLogic.sorted(all, by: .added, reversed: false).map(\.id), ["b", "c", "a"])
        XCTAssertEqual(AlbumLogic.sorted(all, by: .artist, reversed: false).map(\.id), ["b", "c", "a"])
        XCTAssertEqual(AlbumLogic.sorted(all, by: .year, reversed: false).map(\.id), ["c", "a", "b"])
        XCTAssertEqual(AlbumLogic.sorted(all, by: .tracks, reversed: false).first?.id, "c")
        XCTAssertEqual(AlbumLogic.sorted(all, by: .length, reversed: false).map(\.id), ["c", "a", "b"])
        XCTAssertEqual(AlbumLogic.sorted(all, by: .title, reversed: true).map(\.id), ["c", "a", "b"])
    }

    func testByline() {
        XCTAssertEqual(AlbumLogic.byline(album(tracks: [])), "Derango · 2003")
        XCTAssertEqual(AlbumLogic.byline(album(artist: nil, year: nil, tracks: [])), "")
    }

    func testCoverFallsBackToFirstLinkedSong() {
        let a = album(tracks: [AlbumTrack(no: 1, title: "x"), AlbumTrack(no: 2, title: "y", songId: "s2")])
        XCTAssertEqual(AlbumCover.source(a, thumbnails: ["s2": "/covers/s2"]), "/covers/s2")
        var own = a
        own.coverUrl = "/albums/alb_1/cover?v=1"
        XCTAssertEqual(AlbumCover.source(own, thumbnails: ["s2": "/covers/s2"]), "/albums/alb_1/cover?v=1")
        XCTAssertNil(AlbumCover.source(a, thumbnails: [:]))
    }

    func testDecodesUsageWithOwnerNulls() throws {
        let user = try JSONDecoder().decode(ServerUsage.self, from: Data(#"{"songs":10,"max_songs":500,"bytes":1000,"max_bytes":5000,"adds_last_hour":6,"max_adds":20}"#.utf8))
        XCTAssertEqual(user.fetchesLeft, 14)
        XCTAssertEqual(user.bytesLeft, 4000)
        let owner = try JSONDecoder().decode(ServerUsage.self, from: Data(#"{"songs":10,"max_songs":null,"bytes":1000,"max_bytes":null,"adds_last_hour":6,"max_adds":null}"#.utf8))
        XCTAssertNil(owner.fetchesLeft)
        XCTAssertNil(owner.bytesLeft)
    }

    func testPlanCountsWhatToFetchAndCopy() {
        let tracks = [AlbumTrack(no: 1, title: "a", durationS: 100, songId: "phone"), AlbumTrack(no: 2, title: "b", durationS: 100, songId: "server"),
                      AlbumTrack(no: 3, title: "c", durationS: 200, songId: "none"), AlbumTrack(no: 4, title: "d")]
        let songs = ["phone": song("phone"), "server": song("server"), "none": song("none", onServer: false)]
        let plan = AlbumDownloadPlan.make(tracks: tracks, songs: songs, phoneIDs: ["phone"], usage: ServerUsage(maxAdds: 20), bytesPerSecond: 10)
        XCTAssertEqual(plan.total, 4)
        XCTAssertEqual(plan.linked, 3)
        XCTAssertEqual(plan.unlinked, 1)
        XCTAssertEqual(plan.onPhone, 1)
        XCTAssertEqual(plan.toCopy, 1)
        XCTAssertEqual(plan.toFetch, 1)
        XCTAssertEqual(plan.queue, ["server", "none"])
        XCTAssertEqual(plan.estimatedBytes, 3000)
        XCTAssertEqual(plan.fetchBytes, 2000)
        XCTAssertEqual(plan.fetchesLeft, 20)
        XCTAssertTrue(plan.runnable)
        XCTAssertEqual(plan.linkedLine, "3 of 4 tracks are linked to songs")
        XCTAssertEqual(plan.quotaLine, "20 server fetches left this hour")
        XCTAssertTrue(plan.costLine.hasPrefix("3 tracks, 1 on the phone, 1 to fetch, 1 to copy, about "))
    }

    func testPlanWaitsForTheHourlyLimit() {
        let tracks = (1...5).map { AlbumTrack(no: $0, title: "t\($0)", durationS: 60, songId: "s\($0)") }
        let songs = Dictionary(uniqueKeysWithValues: (1...5).map { ("s\($0)", song("s\($0)", onServer: false)) })
        let usage = ServerUsage(addsLastHour: 18, maxAdds: 20)
        let plan = AlbumDownloadPlan.make(tracks: tracks, songs: songs, phoneIDs: [], usage: usage, bytesPerSecond: 1)
        XCTAssertEqual(plan.fetchesLeft, 2)
        XCTAssertEqual(plan.waitingForQuota, 3)
        XCTAssertNotNil(plan.waitLine)
        XCTAssertTrue(plan.runnable)
    }

    func testPlanIsBlockedWhenStorageIsFullOrTooSmall() {
        let tracks = [AlbumTrack(no: 1, title: "a", durationS: 100, songId: "s1")]
        let songs = ["s1": song("s1", onServer: false)]
        let full = AlbumDownloadPlan.make(tracks: tracks, songs: songs, phoneIDs: [], usage: ServerUsage(bytes: 5000, maxBytes: 5000), bytesPerSecond: 10)
        XCTAssertEqual(full.blocked, "Your storage is full. Delete some songs to free space.")
        XCTAssertFalse(full.runnable)
        let tight = AlbumDownloadPlan.make(tracks: tracks, songs: songs, phoneIDs: [], usage: ServerUsage(bytes: 4500, maxBytes: 5000), bytesPerSecond: 10)
        XCTAssertNotNil(tight.blocked)
        let owner = AlbumDownloadPlan.make(tracks: tracks, songs: songs, phoneIDs: [], usage: ServerUsage(), bytesPerSecond: 10)
        XCTAssertNil(owner.blocked)
        let copyOnly = AlbumDownloadPlan.make(tracks: tracks, songs: ["s1": song("s1")], phoneIDs: [], usage: ServerUsage(bytes: 5000, maxBytes: 5000), bytesPerSecond: 10)
        XCTAssertNil(copyOnly.blocked)
    }

    func testPlanWithNothingToDoIsNotRunnable() {
        let tracks = [AlbumTrack(no: 1, title: "a", songId: "s1")]
        let plan = AlbumDownloadPlan.make(tracks: tracks, songs: ["s1": song("s1")], phoneIDs: ["s1"], usage: nil, bytesPerSecond: 10)
        XCTAssertEqual(plan.pending, 0)
        XCTAssertFalse(plan.runnable)
    }

    func testBytesPerSecondUsesUsageOrFallback() {
        let songs = [song("a", duration: 100), song("b", duration: 100), song("c", duration: 100, onServer: false)]
        XCTAssertEqual(AlbumDownloadPlan.bytesPerSecond(songs: songs, usage: ServerUsage(bytes: 2000)), 10)
        XCTAssertEqual(AlbumDownloadPlan.bytesPerSecond(songs: songs, usage: nil), AlbumDownloadPlan.fallbackBytesPerSecond)
        XCTAssertEqual(AlbumDownloadPlan.bytesPerSecond(songs: [], usage: ServerUsage(bytes: 2000)), AlbumDownloadPlan.fallbackBytesPerSecond)
    }
}

final class AlbumRunTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    func testStartsTracksInAlbumOrder() {
        var run = AlbumRun(ids: ["a", "b", "c"])
        XCTAssertEqual(run.next(now: t0), "a")
        XCTAssertEqual(run.next(now: t0), "b")
        run.finish("a")
        XCTAssertEqual(run.next(now: t0), "c")
        XCTAssertNil(run.next(now: t0))
        XCTAssertEqual(run.done, 1)
    }

    func testHourlyLimitPausesAndResumesWithFakedClock() {
        var run = AlbumRun(ids: ["a", "b"])
        XCTAssertEqual(run.next(now: t0), "a")
        run.limited("a", now: t0, minutes: 12)
        XCTAssertNil(run.next(now: t0.addingTimeInterval(60)))
        XCTAssertEqual(run.pauseText(now: t0.addingTimeInterval(60)), "Paused: hourly limit, resumes in 11 min")
        XCTAssertEqual(run.waiting, 2)
        XCTAssertNil(run.next(now: t0.addingTimeInterval(719)))
        XCTAssertEqual(run.next(now: t0.addingTimeInterval(720)), "a")
        XCTAssertNil(run.pauseText(now: t0.addingTimeInterval(720)))
    }

    func testLimitWaitsAtLeastOneMinute() {
        var run = AlbumRun(ids: ["a"])
        _ = run.next(now: t0)
        run.limited("a", now: t0, minutes: 0)
        XCTAssertEqual(run.pauseRemaining(now: t0), 60)
    }

    func testRepeatedFailuresStopTheRun() {
        var run = AlbumRun(ids: ["a", "b", "c", "d"])
        for _ in 0..<3 { if let id = run.next(now: t0) { run.fail(id, "no") } }
        XCTAssertEqual(run.stopReason, "stopped after repeated errors")
        XCTAssertNil(run.next(now: t0))
        XCTAssertEqual(run.summary, "0 of 4 on the phone, 3 failed, stopped after repeated errors")
    }

    func testASuccessResetsTheFailureStreak() {
        var run = AlbumRun(ids: ["a", "b", "c", "d", "e"])
        let first = run.next(now: t0)!
        run.fail(first, "x")
        let second = run.next(now: t0)!
        run.fail(second, "x")
        let third = run.next(now: t0)!
        run.finish(third)
        let fourth = run.next(now: t0)!
        run.fail(fourth, "x")
        XCTAssertNil(run.stopReason)
    }

    func testFatalFailureStopsAtOnce() {
        var run = AlbumRun(ids: ["a", "b"])
        let id = run.next(now: t0)!
        run.fail(id, "Your storage is full.", fatal: true)
        XCTAssertEqual(run.stopReason, "Your storage is full.")
        XCTAssertNil(run.next(now: t0))
    }

    func testSummaryAndProgress() {
        var run = AlbumRun(ids: ["a", "b", "c"])
        let a = run.next(now: t0)!
        run.finish(a)
        let b = run.next(now: t0)!
        run.fail(b, "x")
        XCTAssertEqual(run.progressText, "2 of 3")
        XCTAssertEqual(run.summary, "1 of 3 on the phone, 1 failed")
        run.cancelled = true
        XCTAssertEqual(run.summary, "1 of 3 on the phone, 1 failed, cancelled")
        XCTAssertNil(run.next(now: t0))
    }

    func testRetryMinutesReadsTheRefusalText() {
        XCTAssertEqual(AlbumRun.retryMinutes(from: "You can add 20 songs per hour. Try again in 37 min."), 37)
        XCTAssertEqual(AlbumRun.retryMinutes(from: "Try again later"), 1)
    }
}
