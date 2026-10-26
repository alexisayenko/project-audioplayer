import CryptoKit
import Foundation
import os

private let anonLog = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.alexisayenko.audioplayer", category: "anon")

/// What the Add sheet shows for one account-free download.
struct AnonJobState: Equatable {
    var title: String?
    var artist: String?
    var progress: Double = 0
    var waiting = true
    /// A failure or pause in words for the person; nil while all is well.
    var message: String?
    /// True when the message is final (the job is gone); false when the transfer will resume.
    var failed = false
    var finished = false
}

/// Adds a song from a link without an account: the server stages the audio for a short while, the phone copies it with a
/// resumable download, checks its SHA-256, keeps it in the local library and then tells the server to delete its copy.
@MainActor
final class AnonDownloader: ObservableObject {
    struct Job: Codable, Equatable {
        var id: String
        var url: String
        var server: String
        var meta: AnonMeta?
        var size: Int64?
        var sha256: String?
        var expiresAt: Date?
        var localID: String?
        var retriedDamaged = false
        /// The id the server knows after a restart; `id` stays the stable local handle.
        var serverID: String?
        var restarted: Bool?
        /// Set once the song is stored on the phone; only the acknowledgement is left.
        var storedSHA: String?
    }

    @Published private(set) var book = TransferBook()
    @Published private(set) var states: [String: AnonJobState] = [:]
    /// A failure to tell the person about once (Library shows it as a toast).
    @Published var notice: String?

    var transfers: [String: Transfer] { book.items }

    private var jobs: [Job] = []
    private var running: [String: Task<Void, Never>] = [:]
    private var trackKeys: [String: String] = [:]
    private let makeAPI: @Sendable (String) -> AnonAPI
    private let directory: URL
    private let sleep: @Sendable (Double) async -> Void

    private static let pollDeadline: TimeInterval = 15 * 60
    private static let maxTransferTries = 4
    private static let maxNotReadyWaits = 30
    /// The server share of the progress bar; the copy to the phone takes the rest.
    private static let serverShare = 0.8

    init(makeAPI: @escaping @Sendable (String) -> AnonAPI = { LiveAnonAPI(baseURL: $0) },
         directory: URL? = nil,
         sleep: @escaping @Sendable (Double) async -> Void = { try? await Task.sleep(for: .seconds($0)) }) {
        self.makeAPI = makeAPI
        self.sleep = sleep
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("anon", isDirectory: true)
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        jobs = (try? Data(contentsOf: indexURL)).flatMap { try? JSONDecoder().decode([Job].self, from: $0) } ?? []
    }

    // MARK: Entry points

    /// Creates the server job for a pasted link and keeps the transfer going in the background. Throws when the server refuses the link.
    func start(url: String, serverURL: String, library: LibraryStore) async throws -> String {
        let link = cleanPasted(url)
        let id = try await makeAPI(serverURL).createJob(url: link)
        let job = Job(id: id, url: link, server: serverURL)
        jobs.removeAll { $0.id == id }
        jobs.append(job)
        saveIndex()
        states[id] = AnonJobState()
        launch(job.id, library: library)
        return id
    }

    /// Continues the jobs left by an earlier run (relaunch, lost connection) while the server still keeps them.
    func resumePending(library: LibraryStore) {
        for job in jobs where running[job.id] == nil {
            if job.storedSHA == nil, let expiry = job.expiresAt, expiry.timeIntervalSinceNow < -86_400 {
                discard(job.id, message: nil, notify: false)
                continue
            }
            states[job.id] = states[job.id] ?? AnonJobState(title: job.meta?.title, artist: job.meta?.artist)
            launch(job.id, library: library)
        }
    }

    func dismiss(_ jobID: String) { states[jobID] = nil }

    var hasPending: Bool { !jobs.isEmpty }

    // MARK: Local ids

    /// A stable song id from the server's `video_id` and `platform`, matching `[A-Za-z0-9._-]{1,80}`.
    nonisolated static func localID(_ meta: AnonMeta) -> String? {
        guard let video = meta.video_id?.trimmingCharacters(in: .whitespacesAndNewlines), !video.isEmpty else { return nil }
        let platform = (meta.platform ?? "").lowercased().filter { $0.isLetter || $0.isNumber }
        var raw = video
        if !platform.isEmpty, platform != "youtube", !video.lowercased().hasPrefix(platform + "-") { raw = platform + "-" + video }
        var id = String(raw.map { $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) ? $0 : "_" }.prefix(80))
        if id.hasPrefix(".") { id = "a" + id.dropFirst() }
        return id.isEmpty ? nil : id
    }

    // MARK: The transfer

    private func launch(_ id: String, library: LibraryStore) {
        guard running[id] == nil else { return }
        running[id] = Task { [weak self] in
            await self?.run(id, library: library)
            self?.running[id] = nil
        }
    }

    private enum Stop: Error {
        case permanent(String)
        case paused(String)
    }

    private func job(_ id: String) -> Job? { jobs.first { $0.id == id } }

    private func update(_ id: String, _ change: (inout Job) -> Void) {
        guard let i = jobs.firstIndex(where: { $0.id == id }) else { return }
        change(&jobs[i])
        saveIndex()
    }

    private func serverID(_ id: String) -> String { job(id)?.serverID ?? id }

    private func run(_ id: String, library: LibraryStore) async {
        guard let first = job(id) else { return }
        let api = makeAPI(first.server)
        let placeholder = trackKey(for: id)
        if !book.contains(placeholder) { book.start(placeholderTrack(first, key: placeholder)) }
        defer { clearTransfer(id) }
        do {
            var force = false
            while true {
                if job(id)?.storedSHA == nil {
                    do {
                        let ready = try await waitUntilReady(id, api: api)
                        try await transfer(id, status: ready, api: api, library: library, force: force)
                    } catch AnonError.expired where job(id)?.restarted != true && job(id)?.storedSHA == nil {
                        try await restart(id, api: api)
                        continue
                    }
                }
                if try await acknowledge(id, api: api) { break }
                update(id) { $0.storedSHA = nil; $0.retriedDamaged = true }
                force = true
            }
        } catch Stop.permanent(let message) {
            discard(id, message: message, notify: true)
        } catch Stop.paused(let message) {
            pause(id, message: message)
        } catch is CancellationError {
            pause(id, message: nil)
        } catch let e as AnonError {
            if e.isTransient { pause(id, message: e.errorDescription) } else { discard(id, message: e.errorDescription, notify: true) }
        } catch {
            discard(id, message: "Couldn't save the song on this iPhone. Check the free space and try again.", notify: true)
        }
    }

    /// The server forgot the job (it keeps jobs in memory and empties its staging folder on restart): ask for a fresh one, once.
    private func restart(_ id: String, api: AnonAPI) async throws {
        guard let old = job(id) else { throw AnonError.expired }
        let partial = partialURL(id)
        try? FileManager.default.removeItem(at: partial)
        try? FileManager.default.removeItem(at: partial.appendingPathExtension("etag"))
        let fresh = try await api.createJob(url: old.url)
        update(id) {
            $0.serverID = fresh
            $0.restarted = true
            $0.expiresAt = nil
            $0.size = nil
            $0.sha256 = nil
        }
        setState(id) { $0.progress = 0; $0.waiting = true; $0.message = nil }
        anonLog.debug("restarted \(id, privacy: .public)")
    }

    private func waitUntilReady(_ id: String, api: AnonAPI) async throws -> AnonJobStatus {
        var delay = 1.0
        var misses = 0
        let started = Date()
        while true {
            try Task.checkCancellation()
            do {
                let st = try await api.status(serverID(id))
                misses = 0
                if let meta = st.meta { adopt(id, meta: meta, status: st) }
                switch st.status {
                case "ready": return st
                case "failed": throw Stop.permanent(AnonError.message(forCode: st.error_code))
                default:
                    let queued = st.status == "queued"
                    setProgress(id, Self.serverShare * (queued ? 0 : min(1, max(0, st.progress ?? 0))), waiting: queued)
                }
            } catch let e as AnonError {
                if !e.isTransient { throw e }
                misses += 1
                if misses >= 8 { throw e }
                if let wait = e.retryAfter { await sleep(Double(min(max(wait, 1), 30))); continue }
            }
            if Date().timeIntervalSince(started) > Self.pollDeadline { throw Stop.permanent("The server took too long. Add the link again.") }
            await sleep(delay)
            delay = min(delay * 1.5, 4)
        }
    }

    private func transfer(_ id: String, status st: AnonJobStatus, api: AnonAPI, library: LibraryStore, force: Bool = false) async throws {
        guard let meta = st.meta, let localID = Self.localID(meta), let size = st.size, size > 0, let expected = st.sha256?.lowercased(), !expected.isEmpty else {
            throw Stop.permanent("The server's reply was incomplete. Add the link again.")
        }
        adopt(id, meta: meta, status: st)
        update(id) { $0.localID = localID; $0.size = size; $0.sha256 = expected }
        if !force, library.contains(localID) {
            update(id) { $0.storedSHA = expected }
            setState(id) { $0.finished = true; $0.progress = 1; $0.waiting = false }
            return
        }
        let partial = partialURL(id)
        var tries = 0
        var waits = 0
        var actual = ""
        while true {
            try Task.checkCancellation()
            do {
                try await api.downloadFile(serverID(id), to: partial, expectedSize: size) { [weak self] p in
                    Task { @MainActor in self?.setProgress(id, Self.serverShare + (1 - Self.serverShare) * p, waiting: false) }
                }
                actual = try await Self.sha256(of: partial)
                if actual == expected { break }
                try? FileManager.default.removeItem(at: partial)
                try? FileManager.default.removeItem(at: partial.appendingPathExtension("etag"))
                if job(id)?.retriedDamaged == true { throw AnonError.damaged }
                update(id) { $0.retriedDamaged = true }
            } catch AnonError.notReady {
                waits += 1
                if waits >= Self.maxNotReadyWaits { throw AnonError.notReady }
                await sleep(2)
            } catch let e as AnonError where e.isTransient && e != .mobileDataOff {
                tries += 1
                if tries >= Self.maxTransferTries { throw e }
                await sleep(Double(e.retryAfter.map { min(max($0, 1), 30) } ?? (1 << tries)))
            }
        }
        let track = try store(partial, localID: localID, meta: meta)
        if let data = try? await api.cover(serverID(id)), let source = LocalCover.write(data, for: localID) {
            var t = track
            t.thumbnail = source
            library.addLocal(t)
        } else {
            library.addLocal(track)
        }
        update(id) { $0.storedSHA = actual }
        setState(id) { $0.finished = true; $0.progress = 1; $0.waiting = false }
        anonLog.debug("stored \(localID, privacy: .public)")
    }

    private func store(_ partial: URL, localID: String, meta: AnonMeta) throws -> Track {
        let track = Track(id: localID, title: meta.title ?? "Untitled", artist: meta.artist ?? "", duration: meta.duration,
                          thumbnail: nil, year: meta.year, sourceURL: meta.source_url, addedAt: Date(), onServer: false, localOnly: true)
        let fm = FileManager.default
        try fm.createDirectory(at: LibraryStore.audioDirectory, withIntermediateDirectories: true)
        let dest = AudioFiles.reserve(track)
        try? fm.removeItem(at: dest)
        try fm.moveItem(at: partial, to: dest)
        try? fm.removeItem(at: partial.appendingPathExtension("etag"))
        return track
    }

    /// Tells the server the phone has the file. False when the server says its copy differs: the caller downloads once more.
    private func acknowledge(_ id: String, api: AnonAPI) async throws -> Bool {
        guard let sha = job(id)?.storedSHA else { return true }
        for attempt in 0..<3 {
            do {
                try await api.ack(serverID(id), sha256: sha)
                break
            } catch AnonError.expired {
                break
            } catch AnonError.hashMismatch {
                if job(id)?.retriedDamaged == true { throw AnonError.damaged }
                return false
            } catch let e as AnonError where !e.isTransient {
                break
            } catch {
                if attempt == 2 { return true }
                await sleep(Double(2 << attempt))
            }
        }
        jobs.removeAll { $0.id == id }
        saveIndex()
        return true
    }

    // MARK: Outcomes

    private func discard(_ id: String, message: String?, notify: Bool) {
        let partial = partialURL(id)
        try? FileManager.default.removeItem(at: partial)
        try? FileManager.default.removeItem(at: partial.appendingPathExtension("etag"))
        jobs.removeAll { $0.id == id }
        saveIndex()
        clearTransfer(id)
        if let message {
            setState(id) { $0.message = message; $0.failed = true; $0.waiting = false }
            if notify { notice = message }
        } else {
            states[id] = nil
        }
        anonLog.error("discarded \(id, privacy: .public): \(message ?? "", privacy: .public)")
    }

    private func pause(_ id: String, message: String?) {
        clearTransfer(id)
        guard let message else { return }
        let first = states[id]?.message != message
        setState(id) { $0.message = message; $0.failed = false; $0.waiting = false }
        if first { notice = "\(message) Adding this song will resume later." }
    }

    // MARK: State

    private func trackKey(for id: String) -> String {
        if let k = trackKeys[id] { return k }
        let safe = String(id.map { $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) ? $0 : "_" }.prefix(70))
        let k = "anon-" + safe
        trackKeys[id] = k
        return k
    }

    private func placeholderTrack(_ job: Job, key: String) -> Track {
        Track(id: key, title: job.meta?.title ?? "Adding song\u{2026}", artist: job.meta?.artist ?? "")
    }

    private func adopt(_ id: String, meta: AnonMeta, status st: AnonJobStatus) {
        update(id) {
            $0.meta = meta
            $0.expiresAt = st.expires_at ?? $0.expiresAt
            $0.size = st.size ?? $0.size
            $0.sha256 = st.sha256 ?? $0.sha256
        }
        setState(id) { $0.title = meta.title; $0.artist = meta.artist }
        let key = trackKey(for: id)
        let localID = Self.localID(meta) ?? key
        let track = Track(id: localID, title: meta.title ?? "Adding song\u{2026}", artist: meta.artist ?? "", duration: meta.duration)
        if book.contains(key), key != localID {
            book.replace(key, with: track)
            trackKeys[id] = localID
        } else if let existing = book.items[key]?.track, existing.title != track.title || existing.artist != track.artist {
            book.replace(key, with: track)
            trackKeys[id] = localID
        }
    }

    private func setProgress(_ id: String, _ value: Double, waiting: Bool) {
        let key = trackKey(for: id)
        book.setProgress(key, generation: book.generation(key), value)
        setState(id) { $0.progress = max($0.progress, value); $0.waiting = waiting; $0.message = nil }
    }

    private func setState(_ id: String, _ change: (inout AnonJobState) -> Void) {
        var s = states[id] ?? AnonJobState()
        change(&s)
        if states[id] != s { states[id] = s }
    }

    private func clearTransfer(_ id: String) {
        guard let key = trackKeys[id] else { return }
        if let gen = book.generation(key) { book.finish(key, generation: gen) }
        trackKeys[id] = nil
    }

    // MARK: Files

    private var indexURL: URL { directory.appendingPathComponent("jobs.json") }

    private func partialURL(_ id: String) -> URL {
        let safe = id.map { $0.isASCII && ($0.isLetter || $0.isNumber || "-_".contains($0)) ? $0 : "_" }
        return directory.appendingPathComponent(String(safe.prefix(100)) + ".part")
    }

    private func saveIndex() {
        if let data = try? JSONEncoder().encode(jobs) { try? data.write(to: indexURL, options: .atomic) }
    }

    nonisolated static func sha256(of url: URL) async throws -> String {
        try await Task.detached(priority: .utility) {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var hasher = SHA256()
            while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        }.value
    }
}
