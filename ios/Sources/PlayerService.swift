import AVFoundation
import MediaPlayer
import UIKit

/// Plays a queue of local tracks with background audio and lock-screen controls.
@MainActor
final class PlayerService: ObservableObject {
    @Published private(set) var queue: [Track] = []
    @Published private(set) var index: Int?
    @Published private(set) var isPlaying = false
    @Published private(set) var position: Double = 0
    @Published private(set) var duration: Double = 0

    @Published private(set) var queueTags: [String] = []
    @Published var shuffle = UserDefaults.standard.bool(forKey: "shuffle") {
        didSet { UserDefaults.standard.set(shuffle, forKey: "shuffle"); played = current.map { [$0.id] } ?? []; history = [] }
    }
    @Published var repeatMode = RepeatMode(rawValue: UserDefaults.standard.string(forKey: "repeat") ?? "") ?? .off {
        didSet { UserDefaults.standard.set(repeatMode.rawValue, forKey: "repeat") }
    }

    enum RepeatMode: String {
        case off, all, one

        var next: RepeatMode {
            switch self {
            case .off: return .all
            case .all: return .one
            case .one: return .off
            }
        }

        var spokenName: String {
            switch self {
            case .off: return "off"
            case .all: return "whole list"
            case .one: return "one song"
            }
        }
    }

    @Published var volume: Double = 1 { didSet { player.volume = Float(volume) } }

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var played: [String] = []
    private var history: [String] = []
    private var manual: Set<String> = []
    private var viaTags: [String: Set<String>] = [:]
    private var artwork: MPMediaItemArtwork?
    private var artworkID: String?
    private var artworkTask: Task<Void, Never>?

    var current: Track? { index.flatMap { queue.indices.contains($0) ? queue[$0] : nil } }

    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                guard let self else { return }
                self.position = time.seconds.isFinite ? time.seconds : 0
                self.updateNowPlaying()
            }
        }
        setupRemoteCommands()
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let opts = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            Task { @MainActor in
                guard let self, let raw, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
                if type == .began { self.isPlaying = false }
                else if AVAudioSession.InterruptionOptions(rawValue: opts).contains(.shouldResume) { self.resume() }
            }
        }
    }

    func play(_ tracks: [Track], startAt start: Int) {
        queue = tracks
        manual = Set(tracks.map(\.id))
        viaTags = [:]
        queueTags = []
        played = []
        history = []
        load(start, remember: false)
    }

    /// Inserts the song after the current one and plays it.
    func playNow(_ track: Track) {
        guard let index, current != nil else { return play([track], startAt: 0) }
        manual.insert(track.id)
        if let at = queue.firstIndex(where: { $0.id == track.id }) {
            queue.remove(at: at)
            let cur = queue.firstIndex { $0.id == current?.id } ?? min(index, queue.count - 1)
            queue.insert(track, at: min(cur + 1, queue.count))
            load(cur + 1)
        } else {
            queue.insert(track, at: min(index + 1, queue.count))
            load(index + 1)
        }
    }

    func playNext(_ track: Track) {
        guard let index else { return play([track], startAt: 0) }
        manual.insert(track.id)
        queue.removeAll { $0.id == track.id && $0.id != current?.id }
        let at = (queue.firstIndex { $0.id == current?.id } ?? index) + 1
        queue.insert(track, at: min(at, queue.count))
    }

    @discardableResult
    func enqueue(_ tracks: [Track]) -> Int {
        manual.formUnion(tracks.map(\.id))
        let fresh = tracks.filter { t in !queue.contains { $0.id == t.id } }
        queue.append(contentsOf: fresh)
        return fresh.count
    }

    /// Union add by tag picks: every song with any picked tag joins the queue; picks become chips.
    @discardableResult
    func addTagged(_ picks: [String], from tracks: [Track]) -> Int {
        for p in picks where !queueTags.contains(where: { $0.lowercased() == p.lowercased() }) { queueTags.append(p) }
        var added = 0
        for t in tracks {
            let hit = picks.filter { p in (t.tags ?? []).contains { $0.lowercased() == p.lowercased() } }
            guard !hit.isEmpty else { continue }
            viaTags[t.id, default: []].formUnion(hit.map { $0.lowercased() })
            if !queue.contains(where: { $0.id == t.id }) { queue.append(t); added += 1 }
        }
        if index == nil, !queue.isEmpty { index = 0; duration = queue[0].duration ?? 0; refreshArtwork(); player.replaceCurrentItem(with: AVPlayerItem(url: queue[0].fileURL)); updateNowPlaying() }
        return added
    }

    func removeQueueTag(_ tag: String) {
        let key = tag.lowercased()
        queueTags.removeAll { $0.lowercased() == key }
        let drop = queue.indices.filter { i in
            let id = queue[i].id
            guard var tags = viaTags[id], tags.contains(key), !manual.contains(id), id != current?.id else { return false }
            tags.remove(key)
            return tags.isEmpty
        }
        for (id, var tags) in viaTags { tags.remove(key); viaTags[id] = tags.isEmpty ? nil : tags }
        removeFromQueue(at: IndexSet(drop))
    }

    /// Keeps only the current song.
    func clearQueue() {
        let keep = current
        queue = keep.map { [$0] } ?? []
        index = keep == nil ? nil : 0
        queueTags = []
        viaTags = [:]
        manual = keep.map { [$0.id] } ?? []
        played = keep.map { [$0.id] } ?? []
        history = []
    }

    func jump(to i: Int) { load(i) }

    func skip(by seconds: Double) { seek(to: min(max(position + seconds, 0), max(duration, 0))) }

    func removeFromQueue(at offsets: IndexSet) {
        let playingID = current?.id
        queue.remove(atOffsets: offsets)
        if let playingID, let i = queue.firstIndex(where: { $0.id == playingID }) { index = i }
    }

    func toggle() { isPlaying ? pause() : resume() }

    func resume() {
        guard current != nil else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        isPlaying = true
        updateNowPlaying()
    }

    func pause() {
        player.pause()
        isPlaying = false
        updateNowPlaying()
    }

    func next() { advance(manual: true) }

    private func advance(manual isManual: Bool) {
        guard let index, let cur = current else { return }
        if repeatMode == .one && !isManual { seek(to: 0); resume(); return }
        var seen = played.contains(cur.id) ? played : played + [cur.id]
        let n = queue.count
        if shuffle {
            var cand = queue.indices.filter { !seen.contains(queue[$0].id) }
            if cand.isEmpty {
                guard repeatMode == .all else { return pause() }
                seen = [cur.id]
                cand = queue.indices.filter { $0 != index }
                if cand.isEmpty { played = seen; seek(to: 0); resume(); return }
            }
            played = seen
            return load(cand.randomElement()!)
        }
        played = seen
        if index + 1 < n { load(index + 1) }
        else if repeatMode == .all { load(0) }
        else { pause() }
    }

    func previous() {
        guard let index else { return }
        if position > 3 { return seek(to: 0) }
        if shuffle {
            while let id = history.popLast() {
                if let at = queue.firstIndex(where: { $0.id == id }), at != index { return load(at, remember: false) }
            }
            return seek(to: 0)
        }
        if index == 0 { seek(to: 0) } else { load(index - 1, remember: false) }
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        position = seconds
        updateNowPlaying()
    }

    private func load(_ i: Int, remember: Bool = true) {
        guard queue.indices.contains(i) else { return }
        if remember, shuffle, let cur = current, i != index { history.append(cur.id) }
        index = i
        refreshArtwork()
        let item = AVPlayerItem(url: queue[i].fileURL)
        player.replaceCurrentItem(with: item)
        duration = queue[i].duration ?? 0
        position = 0
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.advance(manual: false) } }
        resume()
    }

    private func refreshArtwork() {
        artworkTask?.cancel()
        guard let track = current else { artwork = nil; artworkID = nil; return }
        if artworkID != track.id { artwork = nil; artworkID = nil }
        artworkTask = Task { [weak self] in
            do {
                let image = try await Self.artworkImage(for: track)
                guard let self, !Task.isCancelled, self.current?.id == track.id, let image else { return }
                self.artwork = Self.makeArtwork(image)
                self.artworkID = track.id
                self.updateNowPlaying()
            } catch is CancellationError {
                return // cancelled
            } catch {
                NSLog("artwork \(track.id): \(error.localizedDescription)")
            }
        }
    }

    private nonisolated static func makeArtwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in image }
    }

    private nonisolated static var artworkDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("artwork", isDirectory: true)
    }

    private nonisolated static func artworkImage(for track: Track) async throws -> UIImage? {
        let file = artworkDirectory.appendingPathComponent("\(track.id).jpg")
        if let data = try? Data(contentsOf: file), let img = UIImage(data: data) { return img }
        try Task.checkCancellation()
        var data = try await embeddedArtwork(track.fileURL)
        try Task.checkCancellation()
        if data == nil, let source = track.thumbnail { data = try await remoteArtwork(source) }
        try Task.checkCancellation()
        guard let data, let img = UIImage(data: data) else { return nil }
        try? FileManager.default.createDirectory(at: artworkDirectory, withIntermediateDirectories: true)
        try? (img.jpegData(compressionQuality: 0.9) ?? data).write(to: file, options: .atomic)
        return img
    }

    private nonisolated static func embeddedArtwork(_ url: URL) async throws -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let items = try await AVURLAsset(url: url).load(.commonMetadata)
        let art = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .commonIdentifierArtwork)
        guard let item = art.first else { return nil }
        return try await item.load(.dataValue)
    }

    private nonisolated static func remoteArtwork(_ source: String) async throws -> Data? {
        let settings = await MainActor.run { Settings() }
        let (base, token) = await MainActor.run { (settings.serverURL, settings.token) }
        return try await withThrowingTaskGroup(of: Data?.self) { group in
            group.addTask {
                if source.hasPrefix("/") { return try await APIClient(baseURL: base, token: token).fetch(source) }
                guard let url = CoverURL.resolve(source, baseURL: base, token: "") else { return nil }
                var req = URLRequest(url: url)
                req.timeoutInterval = 10
                return try await URLSession.shared.data(for: req).0
            }
            group.addTask {
                try await Task.sleep(for: .seconds(10))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            return try await group.next() ?? nil
        }
    }

    private func updateNowPlaying() {
        guard let track = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let artwork, artworkID == track.id { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.previous() }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: event.positionTime) }
            return .success
        }
    }
}
