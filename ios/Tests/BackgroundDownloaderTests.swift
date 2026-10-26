import XCTest
@testable import AudioPlayer

final class BackgroundDownloaderTests: XCTestCase {
    private func makeDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("bgdl-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func testSongsThatArrivedWhileTheAppWasGoneAreHandedOverOnce() throws {
        let dir = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let state = #"{"pending":{},"arrived":[{"id":"abc","title":"T","artist":"A"},{"id":"def","title":"U","artist":"B"}]}"#
        try Data(state.utf8).write(to: dir.appendingPathComponent("state.json"))

        let downloader = BackgroundDownloader(directory: dir)
        XCTAssertEqual(downloader.takeArrived().map(\.id), ["abc", "def"])
        XCTAssertTrue(downloader.takeArrived().isEmpty)

        let again = BackgroundDownloader(directory: dir)
        XCTAssertTrue(again.takeArrived().isEmpty)
    }

    func testMissingStateFileMeansNothingArrived() throws {
        let dir = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertTrue(BackgroundDownloader(directory: dir).takeArrived().isEmpty)
    }
}
