import Combine
import XCTest
@testable import AudioPlayer

@MainActor
final class TransferProgressTests: XCTestCase {
    func testASameValueDoesNotPublish() {
        let board = TransferProgress()
        var publishes = 0
        let watch = board.objectWillChange.sink { publishes += 1 }
        board.set("a", 0.2)
        board.set("a", 0.2)
        board.set("a", 0.3)
        XCTAssertEqual(publishes, 2)
        XCTAssertEqual(board.values["a"], 0.3)
        watch.cancel()
    }

    func testClearingAnUnknownSongDoesNotPublish() {
        let board = TransferProgress()
        board.set("a", 0.5)
        var publishes = 0
        let watch = board.objectWillChange.sink { publishes += 1 }
        board.clear("missing")
        board.clear(["missing", "other"])
        XCTAssertEqual(publishes, 0)
        board.clear(["a", "missing"])
        XCTAssertEqual(publishes, 1)
        XCTAssertNil(board.values["a"])
        watch.cancel()
    }
}
