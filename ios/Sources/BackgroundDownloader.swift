import Foundation
import Network

/// Copies song files from the server with a background `URLSession` (IOS-106): the system keeps the transfer going while the
/// app is suspended and relaunches the app when it finishes. The finished file is placed in `Documents/audio` by the delegate
/// itself, so it lands even when the process that asked for it is gone; such songs are handed over by `takeArrived()`.
final class BackgroundDownloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let shared = BackgroundDownloader()
    static let identifier = (Bundle.main.bundleIdentifier ?? "com.alexisayenko.audioplayer") + ".downloads"

    private struct Entry: Codable {
        var taskID: Int
        var track: Track
    }

    private struct State: Codable {
        var pending: [String: Entry] = [:]
        var arrived: [Track] = []
    }

    private enum Outcome {
        case stored
        case rejected
        case failed(Error)

        var isStored: Bool {
            if case .stored = self { return true }
            return false
        }
    }

    private final class Waiter {
        let onProgress: (@Sendable (Double) -> Void)?
        let continuation: CheckedContinuation<URLResponse, Error>
        init(onProgress: (@Sendable (Double) -> Void)?, continuation: CheckedContinuation<URLResponse, Error>) {
            self.onProgress = onProgress
            self.continuation = continuation
        }
    }

    private let lock = NSLock()
    private let directory: URL
    private var state: State
    private var waiters: [Int: Waiter] = [:]
    private var outcomes: [Int: Outcome] = [:]
    private var eventsDone: (() -> Void)?
    private let monitor = NWPathMonitor()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    init(directory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("downloads", isDirectory: true)) {
        self.directory = directory
        state = PlayStore.read(State.self, "state.json", in: directory) ?? State()
        super.init()
        monitor.start(queue: DispatchQueue(label: "downloads.path"))
    }

    /// Reconnects to transfers left by an earlier run, so their events reach the delegate. Safe to call again.
    func reconnect() { _ = session }

    /// Called by the app delegate when the system relaunched the app for this session; `done` runs once the events are handled.
    func handleEvents(_ done: @escaping () -> Void) {
        lock.withLock { eventsDone = done }
        reconnect()
    }

    /// Songs whose file arrived while nobody waited for it (the app was relaunched by the system). Each is returned once.
    func takeArrived() -> [Track] {
        lock.withLock {
            let tracks = state.arrived
            guard !tracks.isEmpty else { return [] }
            state.arrived = []
            save()
            return tracks
        }
    }

    /// Fetches `request` into the song's audio file. Returns the response; a status outside 200..<300 leaves no file behind.
    func fetch(_ track: Track, request: URLRequest, onProgress: (@Sendable (Double) -> Void)?) async throws -> URLResponse {
        if !request.allowsCellularAccess || !request.allowsExpensiveNetworkAccess || !request.allowsConstrainedNetworkAccess {
            let path = monitor.currentPath
            if path.status == .satisfied, path.isExpensive || path.isConstrained { throw URLError(.dataNotAllowed) }
        }
        for old in await session.allTasks where old.taskDescription == track.id { old.cancel() }
        let task = session.downloadTask(with: request)
        task.taskDescription = track.id
        return try await withCheckedThrowingContinuation { continuation in
            lock.withLock {
                waiters[task.taskIdentifier] = Waiter(onProgress: onProgress, continuation: continuation)
                state.pending[track.id] = Entry(taskID: task.taskIdentifier, track: track)
                save()
            }
            task.resume()
        }
    }

    private func save() { PlayStore.write(state, "state.json", in: directory) }

    func urlSession(_: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let waiter = lock.withLock { waiters[downloadTask.taskIdentifier] }
        waiter?.onProgress?(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let outcome: Outcome
        if let id = downloadTask.taskDescription, (200..<300).contains(status) {
            let dest = AudioFiles.url(for: id)
            do {
                try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? FileManager.default.removeItem(at: dest)
                try FileManager.default.moveItem(at: location, to: dest)
                outcome = .stored
            } catch {
                outcome = .failed(error)
            }
        } else {
            outcome = .rejected
        }
        lock.withLock { outcomes[downloadTask.taskIdentifier] = outcome }
    }

    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let (waiter, outcome) = lock.withLock { (waiters.removeValue(forKey: task.taskIdentifier), outcomes.removeValue(forKey: task.taskIdentifier)) }
        settle(task, stored: error == nil && outcome?.isStored == true, hasWaiter: waiter != nil)
        guard let waiter else { return }
        if let error { return waiter.continuation.resume(throwing: error) }
        switch outcome {
        case .stored, .rejected:
            if let response = task.response { waiter.continuation.resume(returning: response) }
            else { waiter.continuation.resume(throwing: URLError(.badServerResponse)) }
        case .failed(let failure):
            waiter.continuation.resume(throwing: failure)
        case nil:
            waiter.continuation.resume(throwing: URLError(.unknown))
        }
    }

    private func settle(_ task: URLSessionTask, stored: Bool, hasWaiter: Bool) {
        guard let id = task.taskDescription else { return }
        lock.withLock {
            guard let entry = state.pending[id], entry.taskID == task.taskIdentifier else { return }
            state.pending[id] = nil
            if stored, !hasWaiter { state.arrived.append(entry.track) }
            save()
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession _: URLSession) {
        let done = lock.withLock { () -> (() -> Void)? in
            defer { eventsDone = nil }
            return eventsDone
        }
        guard let done else { return }
        DispatchQueue.main.async(execute: done)
    }
}
