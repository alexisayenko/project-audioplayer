import XCTest
@testable import AudioPlayer

/// Mirrors web/js/url-clean.test.mjs and server/tests/test_urlclean.py + test_spotify.py for the Swift port in TagLogic.swift.
final class UrlCleanTests: XCTestCase {
    let yt = "jNQXAC9IVRw"
    let sc = "https://soundcloud.com/some-artist/some-track"
    let spid = "4cOdK2wGLETKBW3PvgPWqT"
    var sp: String { "https://open.spotify.com/track/\(spid)" }

    func testYouTubeFormsBecomeCanonical() {
        let canon = "https://www.youtube.com/watch?v=\(yt)"
        for raw in ["https://youtu.be/\(yt)?si=abc123", "https://www.youtube.com/watch?v=\(yt)&si=x",
                    "https://m.youtube.com/watch?v=\(yt)&t=5s", "https://www.youtube.com/shorts/\(yt)?si=abc",
                    "youtube.com/watch?v=\(yt)", "  \(canon)  ", yt] {
            XCTAssertEqual(cleanUrl(raw), canon, raw)
        }
    }

    func testSoundcloudFormsBecomeCanonical() {
        for raw in [sc, "http://soundcloud.com/some-artist/some-track", "https://m.soundcloud.com/some-artist/some-track",
                    "soundcloud.com/some-artist/some-track", "  \(sc)?si=abc&utm_source=clipboard  ", "\(sc)/?ref=x#t=10"] {
            XCTAssertEqual(cleanUrl(raw), sc, raw)
            XCTAssertEqual(classifySoundcloud(raw), .track(sc), raw)
        }
        XCTAssertEqual(cleanUrl("\(sc)/s-AbC123?si=zzz"), "\(sc)/s-AbC123")
        XCTAssertEqual(classifySoundcloud("https://soundcloud.com/some-artist/sets/my-set"), .unsupported)
        XCTAssertEqual(classifySoundcloud("https://on.soundcloud.com/AbC123?si=x"), .short("https://on.soundcloud.com/AbC123"))
    }

    func testSpotifyTrackFormsBecomeCanonical() {
        for raw in [sp, "http://open.spotify.com/track/\(spid)", "open.spotify.com/track/\(spid)",
                    "\(sp)?si=AbC123xyz", "\(sp)?si=AbC123xyz&utm_source=copy-link#x",
                    "https://open.spotify.com/intl-de/track/\(spid)?si=1", "https://open.spotify.com/intl-pt-br/track/\(spid)",
                    "https://play.spotify.com/track/\(spid)", "spotify:track:\(spid)", "  \(sp)  "] {
            XCTAssertEqual(classifySpotify(raw), .track(sp), raw)
            XCTAssertEqual(cleanUrl(raw), sp, raw)
        }
        XCTAssertEqual(classifySpotify("https://spotify.link/AbC123?si=x"), .short("https://spotify.link/AbC123"))
        XCTAssertEqual(cleanUrl("spotify.link/AbC123"), "https://spotify.link/AbC123")
    }

    func testOtherSpotifyLinksAreUnsupported() {
        for raw in ["https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
                    "https://open.spotify.com/artist/0q5WvBK5P3cPqBzfKJTVz5", "https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk",
                    "spotify:album:1DFixLWuPkv3KT3TnV35m3", "https://open.spotify.com/track/short", "https://spotify.link/"] {
            XCTAssertEqual(classifySpotify(raw), .unsupported, raw)
        }
        XCTAssertNil(classifySpotify("https://example.com/track/x"))
        XCTAssertNil(classifySpotify("https://youtu.be/\(yt)"))
    }

    func testPastedTextFindsTheLink() {
        XCTAssertEqual(cleanPasted("Listen: \(sp)?si=abc nice"), sp)
        XCTAssertEqual(cleanPasted("check spotify:track:\(spid) out"), sp)
        XCTAssertEqual(cleanPasted("https://spotify.link/AbC123?si=x"), "https://spotify.link/AbC123")
        XCTAssertEqual(cleanPasted("Check this out \(sc)?si=abc thanks"), sc)
        XCTAssertEqual(cleanPasted("listen to this: https://youtu.be/\(yt)?si=abc, nice"), "https://www.youtube.com/watch?v=\(yt)")
        XCTAssertEqual(cleanPasted("some words"), "some words")
    }

    func testSourceOfAndLabel() {
        XCTAssertEqual(sourceOf(id: "spotify-\(spid)"), "spotify")
        XCTAssertEqual(sourceOf(id: "spotify-short"), "youtube")
        XCTAssertEqual(sourceOf(id: "soundcloud-1234567890"), "soundcloud")
        XCTAssertEqual(sourceOf(id: yt), "youtube")
        XCTAssertEqual(sourceLabel("spotify"), "Spotify")
        XCTAssertEqual(sourceLabel(nil), "YouTube")
    }

    func testOtherLinksLoseTrackingParams() {
        XCTAssertEqual(cleanUrl("https://example.com/a?id=7&utm_source=x&si=1&fbclid=z"), "https://example.com/a?id=7")
        XCTAssertEqual(cleanUrl("nonsense"), "nonsense")
    }
}
