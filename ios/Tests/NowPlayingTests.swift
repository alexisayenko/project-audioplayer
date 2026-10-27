import MediaPlayer
import XCTest
@testable import AudioPlayer

final class NowPlayingTests: XCTestCase {
    private func snapshot(album: String? = nil, isPlaying: Bool = true) -> NowPlayingSnapshot {
        var track = Track(id: "aaaaaaaaaaa", title: "Song", artist: "Artist")
        track.album = album
        return NowPlayingSnapshot(track: track, title: "Shown", artist: "Shown Artist", duration: 200, position: 12.5, isPlaying: isPlaying, artwork: nil)
    }

    func testInfoCarriesTheShownTextAndTiming() {
        let info = NowPlaying.info(snapshot())
        XCTAssertEqual(info[MPMediaItemPropertyTitle] as? String, "Shown")
        XCTAssertEqual(info[MPMediaItemPropertyArtist] as? String, "Shown Artist")
        XCTAssertEqual(info[MPMediaItemPropertyPlaybackDuration] as? Double, 200)
        XCTAssertEqual(info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 12.5)
        XCTAssertEqual(info[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1)
    }

    func testPausedRateIsZero() {
        XCTAssertEqual(NowPlaying.info(snapshot(isPlaying: false))[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
    }

    func testAlbumAppearsOnlyWhenNotEmpty() {
        XCTAssertEqual(NowPlaying.info(snapshot(album: "LP"))[MPMediaItemPropertyAlbumTitle] as? String, "LP")
        XCTAssertNil(NowPlaying.info(snapshot(album: ""))[MPMediaItemPropertyAlbumTitle])
        XCTAssertNil(NowPlaying.info(snapshot())[MPMediaItemPropertyAlbumTitle])
        XCTAssertNil(NowPlaying.info(snapshot())[MPMediaItemPropertyArtwork])
    }
}
