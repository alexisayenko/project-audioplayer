import UIKit
import XCTest
@testable import AudioPlayer

final class ArtworkLoaderTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("artwork-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func loader(_ asked: @escaping @Sendable () -> Void = {}) -> ArtworkLoader {
        ArtworkLoader(directory: directory) {
            asked()
            return ArtworkServer(base: "http://127.0.0.1:1", token: "")
        }
    }

    private func writeCover(_ id: String) throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { ctx in
            UIColor.red.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }
        try XCTUnwrap(image.jpegData(compressionQuality: 0.9)).write(to: directory.appendingPathComponent("\(id).jpg"))
    }

    func testACachedCoverIsServedWithoutAskingForTheServer() async throws {
        try writeCover("aaaaaaaaaaa")
        let asked = AskCounter()
        let image = try await loader { asked.bump() }.image(for: Track(id: "aaaaaaaaaaa", title: "T", artist: "A", thumbnail: "/covers/aaaaaaaaaaa"))
        XCTAssertNotNil(image)
        XCTAssertEqual(asked.count, 0)
    }

    func testASongWithoutAnyCoverGivesNoImage() async throws {
        let image = try await loader().image(for: Track(id: "bbbbbbbbbbb", title: "T", artist: "A"))
        XCTAssertNil(image)
    }

    func testRemovingTheCacheEntryForgetsTheCover() throws {
        try writeCover("ccccccccccc")
        let file = directory.appendingPathComponent("ccccccccccc.jpg")
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        ArtworkLoader.removeCached("ccccccccccc", in: directory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testTheCacheFileIsNamedAfterTheSongId() {
        XCTAssertEqual(loader().file("abc").lastPathComponent, "abc.jpg")
    }
}

private final class AskCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.withLock { value } }
    func bump() { lock.withLock { value += 1 } }
}
