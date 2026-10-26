import Foundation

/// `GET /me/usage` (API-046): the owner's `max_*` are null.
struct ServerUsage: Decodable, Equatable {
    var songs: Int
    var maxSongs: Int?
    var bytes: Int64
    var maxBytes: Int64?
    var addsLastHour: Int
    var maxAdds: Int?

    enum CodingKeys: String, CodingKey {
        case songs, bytes
        case maxSongs = "max_songs"
        case maxBytes = "max_bytes"
        case addsLastHour = "adds_last_hour"
        case maxAdds = "max_adds"
    }

    init(songs: Int = 0, maxSongs: Int? = nil, bytes: Int64 = 0, maxBytes: Int64? = nil, addsLastHour: Int = 0, maxAdds: Int? = nil) {
        self.songs = songs
        self.maxSongs = maxSongs
        self.bytes = bytes
        self.maxBytes = maxBytes
        self.addsLastHour = addsLastHour
        self.maxAdds = maxAdds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        songs = try c.decodeIfPresent(Int.self, forKey: .songs) ?? 0
        maxSongs = try? c.decodeIfPresent(Int.self, forKey: .maxSongs)
        bytes = try c.decodeIfPresent(Int64.self, forKey: .bytes) ?? 0
        maxBytes = try? c.decodeIfPresent(Int64.self, forKey: .maxBytes)
        addsLastHour = try c.decodeIfPresent(Int.self, forKey: .addsLastHour) ?? 0
        maxAdds = try? c.decodeIfPresent(Int.self, forKey: .maxAdds)
    }

    /// Server audio fetches still allowed this hour; nil without a limit (the owner).
    var fetchesLeft: Int? { maxAdds.map { max(0, $0 - addsLastHour) } }
    var bytesLeft: Int64? { maxBytes.map { max(0, $0 - bytes) } }
}

/// What "Download album" will do, worked out before the first transfer (IOS-100).
struct AlbumDownloadPlan: Equatable {
    var total = 0
    var linked = 0
    var onPhone = 0
    var toCopy = 0
    var toFetch = 0
    var estimatedBytes: Int64 = 0
    var fetchBytes: Int64 = 0
    var fetchesLeft: Int?
    var blocked: String?
    var queue: [String] = []

    static let fallbackBytesPerSecond = 16_000.0

    var unlinked: Int { total - linked }
    var pending: Int { toCopy + toFetch }
    var runnable: Bool { pending > 0 && blocked == nil }

    /// Tracks that must wait for the hourly limit to reset.
    var waitingForQuota: Int {
        guard let fetchesLeft else { return 0 }
        return max(0, toFetch - fetchesLeft)
    }

    /// Average audio bytes per second over the songs that have audio, from the account's usage.
    static func bytesPerSecond(songs: [Track], usage: ServerUsage?) -> Double {
        let seconds = songs.filter { $0.onServer != false }.compactMap(\.duration).filter { $0 > 0 }.reduce(0, +)
        guard let usage, usage.bytes > 0, seconds > 0 else { return fallbackBytesPerSecond }
        return Double(usage.bytes) / seconds
    }

    static func make(tracks: [AlbumTrack], songs: [String: Track], phoneIDs: Set<String>, usage: ServerUsage?, bytesPerSecond: Double) -> AlbumDownloadPlan {
        var plan = AlbumDownloadPlan(total: tracks.count, fetchesLeft: usage?.fetchesLeft)
        for track in tracks {
            guard let id = track.songId, let song = songs[id] else { continue }
            plan.linked += 1
            if phoneIDs.contains(id) { plan.onPhone += 1; continue }
            let bytes = Int64(max(0, track.durationS ?? song.duration ?? 0) * bytesPerSecond)
            plan.estimatedBytes += bytes
            plan.queue.append(id)
            if song.onServer == false {
                plan.toFetch += 1
                plan.fetchBytes += bytes
            } else {
                plan.toCopy += 1
            }
        }
        plan.blocked = blockReason(plan, usage: usage)
        return plan
    }

    private static func blockReason(_ plan: AlbumDownloadPlan, usage: ServerUsage?) -> String? {
        guard plan.toFetch > 0, let left = usage?.bytesLeft else { return nil }
        if left == 0 { return "Your storage is full. Delete some songs to free space." }
        if plan.fetchBytes > left {
            return "Not enough storage on the server: about \(byteText(plan.fetchBytes)) needed, \(byteText(left)) left."
        }
        return nil
    }

    static func byteText(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    /// "12 tracks, 3 on the phone, 9 to fetch, about 85 MB".
    var costLine: String {
        var parts = ["\(linked) \(linked == 1 ? "track" : "tracks")", "\(onPhone) on the phone"]
        if toFetch > 0 { parts.append("\(toFetch) to fetch") }
        if toCopy > 0 { parts.append("\(toCopy) to copy") }
        if estimatedBytes > 0 { parts.append("about \(Self.byteText(estimatedBytes))") }
        return parts.joined(separator: ", ")
    }

    var linkedLine: String? { unlinked > 0 ? "\(linked) of \(total) tracks are linked to songs" : nil }

    var quotaLine: String? {
        guard let fetchesLeft else { return nil }
        return "\(fetchesLeft) server \(fetchesLeft == 1 ? "fetch" : "fetches") left this hour"
    }

    var waitLine: String? {
        let wait = waitingForQuota
        guard wait > 0 else { return nil }
        return "\(wait) \(wait == 1 ? "track waits" : "tracks wait") for the hourly limit and continue on their own while the app is open."
    }
}

/// The state of one album download: what is waiting, working, done or failed, and the hourly pause.
struct AlbumRun: Equatable {
    enum Item: Equatable {
        case waiting, working, onPhone
        case failed(String)
    }

    static let maxFailureStreak = 3

    private(set) var order: [String]
    private(set) var items: [String: Item]
    private(set) var pausedUntil: Date?
    private(set) var stopReason: String?
    private(set) var failureStreak = 0
    var cancelled = false
    var running = true

    init(ids: [String]) {
        order = ids
        items = Dictionary(uniqueKeysWithValues: ids.map { ($0, Item.waiting) })
    }

    var total: Int { order.count }
    var done: Int { items.values.filter { $0 == .onPhone }.count }
    var failed: Int { items.values.filter { if case .failed = $0 { return true } else { return false } }.count }
    var waiting: Int { items.values.filter { $0 == .waiting }.count }
    var processed: Int { done + failed }
    var stopped: Bool { cancelled || stopReason != nil }

    func pauseRemaining(now: Date) -> TimeInterval {
        guard let pausedUntil else { return 0 }
        return max(0, pausedUntil.timeIntervalSince(now))
    }

    /// The next track to start, in album order; nothing while paused, cancelled or stopped.
    mutating func next(now: Date) -> String? {
        guard !stopped, pauseRemaining(now: now) == 0 else { return nil }
        guard let id = order.first(where: { items[$0] == .waiting }) else { return nil }
        pausedUntil = nil
        items[id] = .working
        return id
    }

    mutating func finish(_ id: String) {
        items[id] = .onPhone
        failureStreak = 0
    }

    mutating func fail(_ id: String, _ message: String, fatal: Bool = false) {
        items[id] = .failed(message)
        failureStreak += 1
        if fatal { stopReason = message } else if failureStreak >= Self.maxFailureStreak { stopReason = "stopped after repeated errors" }
    }

    /// The hourly limit answered: the track goes back to the head of the line and everything waits.
    mutating func limited(_ id: String, now: Date, minutes: Int) {
        items[id] = .waiting
        pausedUntil = now.addingTimeInterval(Double(max(1, minutes)) * 60)
    }

    mutating func finishRun() {
        running = false
    }

    func pauseText(now: Date) -> String? {
        let left = pauseRemaining(now: now)
        guard left > 0 else { return nil }
        let minutes = max(1, Int((left / 60).rounded(.up)))
        return "Paused: hourly limit, resumes in \(minutes) min"
    }

    var progressText: String { "\(processed) of \(total)" }

    /// "11 of 12 on the phone, 1 failed".
    var summary: String {
        var parts = ["\(done) of \(total) on the phone"]
        if failed > 0 { parts.append("\(failed) failed") }
        if cancelled { parts.append("cancelled") }
        if let stopReason { parts.append(stopReason) }
        return parts.joined(separator: ", ")
    }

    /// Minutes to wait from a refusal text such as "Try again in 12 min."; one minute when the text has none.
    static func retryMinutes(from detail: String) -> Int {
        guard let range = detail.range(of: #"(\d+)\s*min"#, options: .regularExpression) else { return 1 }
        let digits = detail[range].prefix { $0.isNumber }
        return max(1, Int(digits) ?? 1)
    }
}
