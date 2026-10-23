import Combine
import Foundation
import Network
#if os(iOS)
import UIKit
#else
import AppKit
#endif

extension Notification.Name {
    static let playsUploaded = Notification.Name("playsUploaded")
}

enum AppLifecycle {
    #if os(iOS)
    static let didBecomeActive = UIApplication.didBecomeActiveNotification
    static let didEnterBackground = UIApplication.didEnterBackgroundNotification
    static let willTerminate = UIApplication.willTerminateNotification
    #else
    static let didBecomeActive = NSApplication.didBecomeActiveNotification
    static let didEnterBackground = NSApplication.didResignActiveNotification
    static let willTerminate = NSApplication.willTerminateNotification
    #endif
}

/// One finished play as `POST /plays` takes it (API-196); `cont` marks a continuation of the previous play of the same song.
struct PlayRecord: Codable, Equatable {
    var timestamp: String
    var songID: String
    var listened: Double
    var cont: Bool?

    enum CodingKeys: String, CodingKey {
        case timestamp, cont
        case songID = "song_id"
        case listened = "listened_s"
    }
}

enum PlayStore {
    static let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("plays", isDirectory: true)

    static func read<T: Decodable>(_ type: T.Type, _ name: String, in dir: URL) -> T? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func write<T: Encodable>(_ value: T?, _ name: String, in dir: URL) {
        let url = dir.appendingPathComponent(name)
        guard let value, let data = try? JSONEncoder().encode(value) else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}

/// Finished plays waiting for the server (task-0056, IOS-088 to IOS-090): stored on disk, sent as `POST /plays`
/// batches with a stable `batch_key`, retried with the same key after a failure, never in the way of playback.
@MainActor
final class PlayQueue {
    static let shared = PlayQueue()
    static let cap = 1000
    static let batchMax = 200
    static let minPlay = 5.0
    static let dropStatuses: Set<Int> = [400, 404, 409, 410, 413, 422]
    static let firstRetry = 30.0
    static let maxRetry = 900.0

    struct Batch: Codable, Equatable {
        var key: String
        var plays: [PlayRecord]
    }

    private struct State: Codable {
        var queue: [PlayRecord] = []
        var batch: Batch?
    }

    private struct Body: Encodable {
        let batchKey: String
        let plays: [PlayRecord]
        enum CodingKeys: String, CodingKey { case batchKey = "batch_key", plays }
    }

    private let directory: URL
    private let keyFactory: () -> String
    private var state: State
    private var settings: Settings?
    private var inflight = false
    private var failures = 0
    private var retryAt: Date?
    private var retryTask: Task<Void, Never>?
    private var cancellables: Set<AnyCancellable> = []
    private var monitor: NWPathMonitor?
    private var offline = false

    init(directory: URL = PlayStore.directory, keyFactory: @escaping () -> String = { UUID().uuidString }) {
        self.directory = directory
        self.keyFactory = keyFactory
        state = PlayStore.read(State.self, "queue.json", in: directory) ?? State()
    }

    /// Starts the flush triggers: app active, connectivity regained, sign-in (session or legacy token). Safe to call again.
    func configure(settings: Settings) {
        self.settings = settings
        guard monitor == nil else { return flush() }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in self?.pathChanged(satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "plays.path"))
        self.monitor = monitor
        NotificationCenter.default.publisher(for: AppLifecycle.didBecomeActive)
            .sink { [weak self] _ in Task { @MainActor in self?.flush() } }
            .store(in: &cancellables)
        AuthService.shared.$session.dropFirst()
            .sink { [weak self] session in
                guard session != nil else { return }
                Task { @MainActor in self?.flush(force: true) }
            }
            .store(in: &cancellables)
        settings.$token.dropFirst()
            .sink { [weak self] token in
                guard !token.isEmpty else { return }
                Task { @MainActor in self?.flush(force: true) }
            }
            .store(in: &cancellables)
        flush()
    }

    func add(_ record: PlayRecord) {
        guard record.listened >= Self.minPlay else { return }
        var rec = record
        rec.listened = (record.listened * 10).rounded() / 10
        state.queue.append(rec)
        if state.queue.count > Self.cap { state.queue.removeFirst(state.queue.count - Self.cap) }
        save()
        flush()
    }

    func flush(force: Bool = false) {
        if force { retryAt = nil }
        guard !inflight, let settings, ServerLink.hasCredentials(settings) else { return }
        if let retryAt, retryAt > Date() { return }
        guard let batch = nextBatch() else { return }
        inflight = true
        Task { await send(batch, settings: settings) }
    }

    private func pathChanged(_ satisfied: Bool) {
        let regained = offline && satisfied
        offline = !satisfied
        if regained { flush(force: true) }
    }

    private func nextBatch() -> Batch? {
        if let batch = state.batch { return batch }
        guard !state.queue.isEmpty else { return nil }
        let batch = Batch(key: keyFactory(), plays: Array(state.queue.prefix(Self.batchMax)))
        state.queue.removeFirst(batch.plays.count)
        state.batch = batch
        save()
        return batch
    }

    private func send(_ batch: Batch, settings: Settings) async {
        #if os(iOS)
        let background = UIApplication.shared.beginBackgroundTask(withName: "plays") {}
        defer { if background != .invalid { UIApplication.shared.endBackgroundTask(background) } }
        #endif
        var status: Int?
        if let body = try? JSONEncoder().encode(Body(batchKey: batch.key, plays: batch.plays)) {
            status = try? await APIClient(baseURL: settings.serverURL, token: settings.token).postPlays(body)
        }
        inflight = false
        if let status, (200..<300).contains(status) || Self.dropStatuses.contains(status) {
            state.batch = nil
            save()
            failures = 0
            retryAt = nil
            if (200..<300).contains(status) { NotificationCenter.default.post(name: .playsUploaded, object: nil) }
            flush()
        } else {
            failures += 1
            let delay = min(Self.firstRetry * pow(2, Double(failures - 1)), Self.maxRetry)
            retryAt = Date().addingTimeInterval(delay)
            retryTask?.cancel()
            retryTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(delay))
                guard !Task.isCancelled else { return }
                self?.flush()
            }
        }
    }

    private func save() { PlayStore.write(state, "queue.json", in: directory) }
}
