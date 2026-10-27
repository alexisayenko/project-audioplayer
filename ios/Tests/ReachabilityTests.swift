import Combine
import XCTest
@testable import AudioPlayer

private final class StubProtocol: URLProtocol {
    static var outcome: Result<Int, URLError> = .success(200)

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "reach.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        switch Self.outcome {
        case .failure(let error):
            client?.urlProtocol(self, didFailWithError: error)
        case .success(let status):
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("{}".utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}

@MainActor
final class ReachabilityTests: XCTestCase {
    private var server: ServerLink!
    private let api = APIClient(baseURL: "https://reach.test", token: "t")

    override func setUp() {
        super.setUp()
        URLProtocol.registerClass(StubProtocol.self)
        StubProtocol.outcome = .success(200)
        server = ServerLink()
    }

    override func tearDown() {
        URLProtocol.unregisterClass(StubProtocol.self)
        server = nil
        super.tearDown()
    }

    private func call() async {
        _ = try? await api.fetch("/albums")
    }

    func testANetworkFailureMarksTheServerUnreachableAndAnAnswerMarksItReachable() async {
        StubProtocol.outcome = .failure(URLError(.notConnectedToInternet))
        await call()
        XCTAssertEqual(server.reachable, false)
        StubProtocol.outcome = .success(200)
        await call()
        XCTAssertEqual(server.reachable, true)
    }

    func testATimeoutCountsAsUnreachable() async {
        StubProtocol.outcome = .failure(URLError(.timedOut))
        await call()
        XCTAssertEqual(server.reachable, false)
    }

    func testHttpErrorsMeanTheServerAnswered() async {
        StubProtocol.outcome = .failure(URLError(.cannotConnectToHost))
        await call()
        for status in [401, 404, 500] {
            StubProtocol.outcome = .success(status)
            await call()
            XCTAssertEqual(server.reachable, true, "status \(status)")
            StubProtocol.outcome = .failure(URLError(.cannotConnectToHost))
            await call()
            XCTAssertEqual(server.reachable, false)
        }
    }

    func testACancelledOrPolicyBlockedRequestChangesNothing() async {
        for code in [URLError.Code.cancelled, .dataNotAllowed, .internationalRoamingOff] {
            StubProtocol.outcome = .failure(URLError(code))
            await call()
            XCTAssertNil(server.reachable, "\(code)")
        }
        XCTAssertTrue(APIClient.isNetworkFailure(URLError(.notConnectedToInternet)))
        XCTAssertFalse(APIClient.isNetworkFailure(URLError(.cancelled)))
    }

    func testTheAlbumsAndPlaylistsCallsReportToo() async {
        StubProtocol.outcome = .failure(URLError(.notConnectedToInternet))
        _ = try? await api.albums()
        XCTAssertEqual(server.reachable, false)
        StubProtocol.outcome = .success(200)
        _ = try? await api.playlists()
        XCTAssertEqual(server.reachable, true)
        StubProtocol.outcome = .failure(URLError(.networkConnectionLost))
        _ = try? await api.playlist("pl_x")
        XCTAssertEqual(server.reachable, false)
    }

    func testOnlyARealChangePublishes() async {
        var publishes = 0
        let watch = server.objectWillChange.sink { publishes += 1 }
        await call()
        XCTAssertEqual(publishes, 1)
        await call()
        server.setReachable(true)
        XCTAssertEqual(publishes, 1)
        StubProtocol.outcome = .failure(URLError(.notConnectedToInternet))
        await call()
        await call()
        XCTAssertEqual(publishes, 2)
        watch.cancel()
    }

    func testADownloadIsNotStartedWhileTheServerIsUnreachable() async {
        server.setReachable(false)
        let track = Track(id: "offline-\(UUID().uuidString)", title: "T", artist: "A")
        let started = await server.download(track, settings: Settings(), into: LibraryStore())
        XCTAssertFalse(started)
        XCTAssertTrue(server.transfers.isEmpty)
        XCTAssertNil(server.progress(of: track.id))
        XCTAssertTrue(server.failed.contains(track.id))
        XCTAssertNotNil(server.notice)
    }

    func testAQuietDownloadFailsWithoutANotice() async {
        server.setReachable(false)
        let track = Track(id: "offline-\(UUID().uuidString)", title: "T", artist: "A")
        let started = await server.download(track, settings: Settings(), into: LibraryStore(), quiet: true)
        XCTAssertFalse(started)
        XCTAssertNil(server.notice)
        XCTAssertTrue(server.failed.contains(track.id))
    }
}
