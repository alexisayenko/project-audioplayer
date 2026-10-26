import Foundation

/// "Download album" (IOS-100): brings the linked tracks of one album onto the phone, two at a time, in album order.
/// A track whose audio is not on the server is fetched there first (one server add each); the hourly limit pauses the run, which continues by itself.
@MainActor
final class AlbumDownloader: ObservableObject {
    @Published private(set) var runs: [String: AlbumRun] = [:]
    @Published private(set) var fetchProgress: [String: Double] = [:]
    private var tasks: [String: Task<Void, Never>] = [:]
    private static let concurrency = 2
    private static let pollSeconds = 2.0
    private static let pollLimit = 450
    private static let copyWaitSeconds = 120

    private enum Outcome {
        case done
        case limited(minutes: Int)
        case failed(String, fatal: Bool)
    }

    func run(for albumID: String) -> AlbumRun? { runs[albumID] }

    func isRunning(_ albumID: String) -> Bool { runs[albumID]?.running == true }

    /// What a track row shows while a run of its album is still on it; nil once the track is finished or failed.
    func rowState(_ songID: String, in albumID: String) -> (progress: Double, waiting: Bool)? {
        guard let run = runs[albumID], run.running, let item = run.items[songID] else { return nil }
        switch item {
        case .waiting: return (0, true)
        case .working: return (fetchProgress[songID] ?? 0, false)
        default: return nil
        }
    }

    func start(album: Album, plan: AlbumDownloadPlan, settings: Settings, library: LibraryStore, server: ServerLink) {
        guard plan.runnable, !isRunning(album.id) else { return }
        runs[album.id] = AlbumRun(ids: plan.queue)
        tasks[album.id] = Task {
            await withTaskGroup(of: Void.self) { group in
                for _ in 0..<Self.concurrency {
                    group.addTask { @MainActor [self] in await worker(album.id, settings: settings, library: library, server: server) }
                }
            }
            runs[album.id]?.cancelled = Task.isCancelled
            runs[album.id]?.finishRun()
            tasks[album.id] = nil
        }
    }

    func cancel(_ albumID: String) {
        tasks[albumID]?.cancel()
    }

    func cancelAll() {
        for task in tasks.values { task.cancel() }
    }

    func dismissResult(_ albumID: String) {
        guard runs[albumID]?.running != true else { return }
        runs[albumID] = nil
    }

    private func worker(_ albumID: String, settings: Settings, library: LibraryStore, server: ServerLink) async {
        while !Task.isCancelled {
            guard var run = runs[albumID], !run.stopped, run.waiting > 0 else { return }
            let wait = run.pauseRemaining(now: Date())
            if wait > 0 {
                try? await Task.sleep(for: .seconds(min(wait, 15)))
                continue
            }
            guard let id = run.next(now: Date()) else { return }
            runs[albumID] = run
            let outcome = await process(id, settings: settings, library: library, server: server)
            apply(outcome, id: id, albumID: albumID)
        }
    }

    private func apply(_ outcome: Outcome, id: String, albumID: String) {
        guard var run = runs[albumID] else { return }
        switch outcome {
        case .done: run.finish(id)
        case .limited(let minutes): run.limited(id, now: Date(), minutes: minutes)
        case .failed(let message, let fatal): run.fail(id, message, fatal: fatal)
        }
        runs[albumID] = run
        fetchProgress[id] = nil
    }

    private func process(_ id: String, settings: Settings, library: LibraryStore, server: ServerLink) async -> Outcome {
        guard let track = library.songs.first(where: { $0.id == id }) else { return .failed("The song left the library", fatal: false) }
        if library.contains(id) { return .done }
        if track.onServer == false, let failure = await fetchOnServer(track, settings: settings) { return failure }
        if Task.isCancelled { return .failed("Cancelled", fatal: false) }
        return await copy(track, settings: settings, library: library, server: server)
    }

    private func fetchOnServer(_ track: Track, settings: Settings) async -> Outcome? {
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        do {
            try await api.fetchAudio(track.id)
        } catch {
            return Self.refusal(error)
        }
        fetchProgress[track.id] = 0
        var misses = 0
        for _ in 0..<Self.pollLimit {
            try? await Task.sleep(for: .seconds(Self.pollSeconds))
            if Task.isCancelled { return .failed("Cancelled", fatal: false) }
            do {
                let status = try await api.status(track.id)
                misses = 0
                fetchProgress[track.id] = 0.8 * (status.isQueued ? 0 : status.progress ?? 0)
                if status.status == "error" { return .failed(status.failureMessage, fatal: Self.isFatal(status.error_code ?? status.code)) }
                if status.status == "done" { return nil }
            } catch {
                misses += 1
                if misses >= 8 { return .failed(error.localizedDescription, fatal: false) }
            }
        }
        return .failed("The server took too long to fetch the audio", fatal: false)
    }

    private func copy(_ track: Track, settings: Settings, library: LibraryStore, server: ServerLink) async -> Outcome {
        for _ in 0..<Self.copyWaitSeconds where server.transfers[track.id] != nil {
            try? await Task.sleep(for: .seconds(1))
        }
        if library.contains(track.id) { return .done }
        let ok = await server.download(track, settings: settings, into: library, quiet: true)
        return ok ? .done : .failed("Couldn't copy to this iPhone", fatal: false)
    }

    private static func refusal(_ error: Error) -> Outcome {
        if case APIError.refused(let code, let detail) = error {
            if code == "hourly_limit" { return .limited(minutes: AlbumRun.retryMinutes(from: detail)) }
            return .failed(detail, fatal: isFatal(code))
        }
        if case APIError.http(429, let detail) = error { return .limited(minutes: AlbumRun.retryMinutes(from: detail)) }
        return .failed(error.localizedDescription, fatal: false)
    }

    private static func isFatal(_ code: String?) -> Bool {
        ["library_full_bytes", "library_full_songs", "server_full"].contains(code ?? "")
    }
}
