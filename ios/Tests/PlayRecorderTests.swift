import XCTest
@testable import AudioPlayer

private final class BundleAnchor {}

private struct Step: Decodable {
    let op: String
    let id: String?
    let to: Double?
    let step: Double?
}

private struct Expected: Decodable, Equatable {
    let song_id: String
    let listened_s: Double
}

private struct RecorderCase: Decodable {
    let name: String
    let ops: [Step]
    let plays: [Expected]
}

@MainActor
final class PlayRecorderTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("recorder-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func cases() throws -> [RecorderCase] {
        let url = try XCTUnwrap(Bundle(for: BundleAnchor.self).url(forResource: "play_recorder_cases", withExtension: "json"))
        return try JSONDecoder().decode([RecorderCase].self, from: Data(contentsOf: url))
    }

    private func run(_ ops: [Step]) -> [Expected] {
        try? FileManager.default.removeItem(at: directory)
        let queue = PlayQueue(directory: directory)
        let recorder = PlayRecorder(queue: queue, directory: directory)
        var playing: String?
        var position = 0.0
        func tick(_ to: Double) {
            position = to
            recorder.tick(songID: playing, position: to)
        }
        for op in ops {
            switch op.op {
            case "start":
                playing = op.id
                tick(0)
            case "resume": tick(position)
            case "advance":
                var t = position + (op.step ?? 0.5)
                while t <= (op.to ?? 0) + 1e-9 {
                    tick(t)
                    t += op.step ?? 0.5
                }
            case "tick": tick(op.to ?? 0)
            case "seek":
                recorder.seeked()
                tick(op.to ?? 0)
            case "pause": recorder.paused(position: position)
            case "song":
                recorder.songChanged()
                playing = op.id
                tick(0)
            case "end": recorder.ended(position: position)
            default: XCTFail("unknown op \(op.op)")
            }
        }
        return queue.pendingPlays.map { Expected(song_id: $0.songID, listened_s: $0.listened) }
    }

    func testTheSharedPlayRecorderCasesMatchTheWebRecorder() throws {
        let all = try cases()
        XCTAssertGreaterThanOrEqual(all.count, 10)
        for c in all { XCTAssertEqual(run(c.ops), c.plays, c.name) }
    }

    func testAPlayContinuesTheSameSongAfterARelaunchWithinTenMinutes() {
        try? FileManager.default.removeItem(at: directory)
        var clock = Date(timeIntervalSince1970: 1_000_000)
        let queue = PlayQueue(directory: directory)
        let first = PlayRecorder(queue: queue, directory: directory, now: { clock })
        for t in stride(from: 0.0, through: 8, by: 0.5) { first.tick(songID: "a", position: t) }
        first.paused(position: 8)
        clock = clock.addingTimeInterval(60)
        let second = PlayRecorder(queue: queue, directory: directory, now: { clock })
        for t in stride(from: 0.0, through: 8, by: 0.5) { second.tick(songID: "a", position: t) }
        second.ended(position: 8)
        let plays = queue.pendingPlays
        XCTAssertEqual(plays.map(\.songID), ["a", "a"])
        XCTAssertEqual(plays.map(\.cont), [nil, true])
    }

    func testAnOpenPlayLeftOnDiskIsQueuedOnTheNextStart() {
        try? FileManager.default.removeItem(at: directory)
        let queue = PlayQueue(directory: directory)
        let first = PlayRecorder(queue: queue, directory: directory)
        for t in stride(from: 0.0, through: 9, by: 0.5) { first.tick(songID: "a", position: t) }
        first.paused(position: 9)
        XCTAssertTrue(queue.pendingPlays.isEmpty)
        _ = PlayRecorder(queue: queue, directory: directory)
        XCTAssertEqual(queue.pendingPlays.map(\.songID), ["a"])
    }

    func testTheOpenPlayCountsBeforeItIsFlushed() {
        try? FileManager.default.removeItem(at: directory)
        let recorder = PlayRecorder(queue: PlayQueue(directory: directory), directory: directory)
        XCTAssertNil(recorder.openRecord)
        for t in stride(from: 0.0, through: 3, by: 0.5) { recorder.tick(songID: "a", position: t) }
        XCTAssertEqual(recorder.openRecord?.songID, "a")
        XCTAssertEqual(recorder.openRecord?.listened, 3)
    }
}
