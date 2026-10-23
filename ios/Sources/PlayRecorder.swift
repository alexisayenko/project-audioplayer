import Foundation

/// Counts what is actually heard and hands finished plays to the `PlayQueue` (task-0056, IOS-087).
/// The rules are those of `web/js/play-recorder.js` (PLY-170 to PLY-177): played time is the sum of forward position steps of
/// at most 1.5 s, a seek or a pause adds nothing, a pause does not end the play, a song change, the end of a song and
/// termination do, and plays under 5 s are dropped.
@MainActor
final class PlayRecorder {
    static let minPlay = PlayQueue.minPlay
    static let maxStep = 1.5
    static let contWindow: TimeInterval = 600
    static let persistEvery = 30.0

    private struct Open: Codable {
        var timestamp: String
        var songID: String
        var listened: Double
        var cont: Bool
    }

    private struct Last: Codable {
        var songID: String
        var at: Date
    }

    private struct Saved: Codable {
        var open: Open?
        var last: Last?
        var savedAt: Date
    }

    private let queue: PlayQueue
    private let directory: URL
    private let now: () -> Date
    private var open: Open?
    private var last: Last?
    private var lastPosition: Double?
    private var persisted = 0.0

    init(queue: PlayQueue? = nil, directory: URL = PlayStore.directory, now: @escaping () -> Date = Date.init) {
        self.queue = queue ?? .shared
        self.directory = directory
        self.now = now
        recover()
        _ = NotificationCenter.default.addObserver(forName: AppLifecycle.didEnterBackground, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.backgrounded() }
        }
        _ = NotificationCenter.default.addObserver(forName: AppLifecycle.willTerminate, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.terminating() }
        }
    }

    /// Called with every position tick. `songID` is the song whose item is attached, or nil when nothing countable plays.
    func tick(songID: String?, position: Double) {
        guard let songID, position.isFinite else {
            if open != nil, lastPosition != nil { persist() }
            lastPosition = nil
            return
        }
        if let current = open, current.songID != songID { close() }
        if open == nil { begin(songID) }
        accumulate(position)
        if let listened = open?.listened, listened - persisted >= Self.persistEvery { persist() }
    }

    func seeked() { lastPosition = nil }

    func paused(position: Double?) {
        if open != nil, let position, position.isFinite { accumulate(position) }
        lastPosition = nil
        persist()
        queue.flush()
    }

    func songChanged() {
        close()
        queue.flush()
    }

    func ended(position: Double?) {
        if let position, position.isFinite { accumulate(position) }
        close()
        queue.flush()
    }

    private func begin(_ songID: String) {
        let cont = last.map { $0.songID == songID && now().timeIntervalSince($0.at) <= Self.contWindow } ?? false
        last = nil
        open = Open(timestamp: Self.iso(now()), songID: songID, listened: 0, cont: cont)
        lastPosition = nil
        persisted = 0
    }

    private func accumulate(_ position: Double) {
        defer { lastPosition = position }
        guard open != nil, let previous = lastPosition else { return }
        let step = position - previous
        if step > 0, step <= Self.maxStep { open?.listened += step }
    }

    private func close() {
        guard let play = open else { return }
        open = nil
        lastPosition = nil
        persisted = 0
        write()
        enqueue(play)
    }

    private func enqueue(_ play: Open) {
        guard play.listened >= Self.minPlay else { return }
        queue.add(PlayRecord(timestamp: play.timestamp, songID: play.songID, listened: play.listened, cont: play.cont ? true : nil))
    }

    private func persist() {
        guard let play = open, play.listened >= Self.minPlay else { return }
        persisted = play.listened
        write()
    }

    private func write() {
        if open == nil && last == nil { return PlayStore.write(nil as Saved?, "open.json", in: directory) }
        PlayStore.write(Saved(open: open, last: last, savedAt: now()), "open.json", in: directory)
    }

    private func recover() {
        guard let saved = PlayStore.read(Saved.self, "open.json", in: directory) else { return }
        last = saved.last
        if let left = saved.open {
            enqueue(left)
            if left.listened >= Self.minPlay { last = Last(songID: left.songID, at: saved.savedAt) }
        }
        write()
    }

    private func backgrounded() {
        persist()
        queue.flush()
    }

    private func terminating() {
        if let play = open {
            open = nil
            lastPosition = nil
            enqueue(play)
            if play.listened >= Self.minPlay { last = Last(songID: play.songID, at: now()) }
        }
        write()
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
