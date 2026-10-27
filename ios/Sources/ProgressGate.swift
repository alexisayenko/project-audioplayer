import Foundation

/// Lets the byte-by-byte progress of one download reach the screen at a calm pace: a value passes only when its whole
/// percent is new and at least `interval` seconds have gone by since the last one that passed; 100% always passes.
final class ProgressGate: @unchecked Sendable {
    static let interval: TimeInterval = 0.25

    private let lock = NSLock()
    private let interval: TimeInterval
    private var percent = -1
    private var passedAt: TimeInterval?

    init(interval: TimeInterval = ProgressGate.interval) {
        self.interval = interval
    }

    func admit(_ value: Double, at now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Bool {
        let next = Int((min(1, max(0, value)) * 100).rounded(.down))
        return lock.withLock {
            guard next != percent else { return false }
            if next < 100, let passedAt, now - passedAt < interval { return false }
            percent = next
            passedAt = now
            return true
        }
    }
}
