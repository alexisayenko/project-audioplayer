import AVFoundation
import Combine
import MediaPlayer

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
    /// Set when the current item could not be played; cleared when another song loads.
    @Published private(set) var failedTrackID: String?

    /// Builds the item for a song; the default plays the file in Documents. The Mac app streams from the server.
    /// The flag asks for fresh credentials after a failed attempt.
    var itemFactory: ((Track, Bool) async -> AVPlayerItem)?
    /// Title and artist for Now Playing; the default is the song's own fields.
    var nowPlayingText: ((Track) -> (title: String, artist: String))?
    /// Called with the item that now plays, or nil when the player holds none.
    var itemObserver: ((AVPlayerItem?) -> Void)?

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
    private var statusObserver: AnyCancellable?
    private var itemTask: Task<Void, Never>?
    private var needsItem = false
    private var retriedID: String?

    var current: Track? { index.flatMap { queue.indices.contains($0) ? queue[$0] : nil } }

    init() {
        PlatformAudio.configure()
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
        NotificationCenter.default.addObserver(forName: .trackThumbnailChanged, object: nil, queue: .main) { [weak self] note in
            let id = note.userInfo?["id"] as? String
            let thumbnail = note.userInfo?["thumbnail"] as? String
            Task { @MainActor in
                guard let self, let id else { return }
                self.thumbnailChanged(id, thumbnail)
            }
        }
        #if os(iOS)
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
        #endif
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
        if index == nil, !queue.isEmpty { index = 0; duration = queue[0].duration ?? 0; refreshArtwork(); cue(queue[0]); updateNowPlaying() }
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
        let was = index ?? 0
        queue.remove(atOffsets: offsets)
        guard let playingID else { return }
        if let i = queue.firstIndex(where: { $0.id == playingID }) { index = i; return }
        player.pause()
        isPlaying = false
        position = 0
        guard !queue.isEmpty else {
            index = nil
            duration = 0
            detach()
            updateNowPlaying()
            return
        }
        let i = min(was, queue.count - 1)
        index = i
        duration = queue[i].duration ?? 0
        cue(queue[i])
        refreshArtwork()
        updateNowPlaying()
    }

    func toggle() { isPlaying ? pause() : resume() }

    func resume() {
        guard let cur = current else { return }
        let failed = failedTrackID == cur.id
        if needsItem || failed {
            if failed { retriedID = nil }
            return install(cur, play: true, refresh: failed)
        }
        PlatformAudio.activate()
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
        duration = queue[i].duration ?? 0
        position = 0
        retriedID = nil
        install(queue[i], play: true)
    }

    private func install(_ track: Track, play: Bool, refresh: Bool = false) {
        itemTask?.cancel()
        needsItem = false
        guard let itemFactory else {
            attach(AVPlayerItem(url: track.fileURL))
            if play { resume() }
            return
        }
        if play {
            PlatformAudio.activate()
            isPlaying = true
            updateNowPlaying()
        }
        itemTask = Task { [weak self] in
            let item = await itemFactory(track, refresh)
            guard let self, !Task.isCancelled, self.current?.id == track.id else { return }
            self.finishInstall(item)
        }
    }

    private func finishInstall(_ item: AVPlayerItem) {
        attach(item)
        if position > 0 { player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) }
        if isPlaying { player.play() }
    }

    private func cue(_ track: Track) {
        itemTask?.cancel()
        retriedID = nil
        guard itemFactory != nil else { return attach(AVPlayerItem(url: track.fileURL)) }
        detach()
        needsItem = true
    }

    private func detach() {
        itemTask?.cancel()
        needsItem = false
        statusObserver = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player.replaceCurrentItem(with: nil)
        itemObserver?(nil)
    }

    private func attach(_ item: AVPlayerItem) {
        failedTrackID = nil
        player.replaceCurrentItem(with: item)
        itemObserver?(item)
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.advance(manual: false) } }
        let id = current?.id
        statusObserver = item.publisher(for: \.status).receive(on: DispatchQueue.main).sink { [weak self] status in
            guard status == .failed else { return }
            MainActor.assumeIsolated {
                guard let self, self.current?.id == id else { return }
                if let id, self.itemFactory != nil, self.retriedID != id, let track = self.current {
                    self.retriedID = id
                    self.install(track, play: self.isPlaying, refresh: true)
                    return
                }
                self.failedTrackID = id
                self.isPlaying = false
                self.updateNowPlaying()
            }
        }
    }

    /// Whether Next would go somewhere.
    var hasNext: Bool {
        guard let index else { return false }
        if repeatMode == .all { return !queue.isEmpty }
        if shuffle { return queue.contains { !played.contains($0.id) && $0.id != current?.id } }
        return index + 1 < queue.count
    }

    /// Moves a queue row; the current song stays current by identity.
    func moveInQueue(from i: Int, to j: Int) {
        guard queue.indices.contains(i), queue.indices.contains(j), i != j else { return }
        let playingID = current?.id
        queue.insert(queue.remove(at: i), at: j)
        if let playingID, let at = queue.firstIndex(where: { $0.id == playingID }) { index = at }
    }

    /// Puts a saved queue back with its song cued and paused.
    func restore(_ tracks: [Track], index start: Int, tags: [String]) {
        guard !tracks.isEmpty, index == nil else { return }
        queue = tracks
        manual = Set(tracks.map(\.id))
        queueTags = tags
        let i = tracks.indices.contains(start) ? start : 0
        index = i
        played = [tracks[i].id]
        duration = tracks[i].duration ?? 0
        position = 0
        cue(tracks[i])
        refreshArtwork()
        updateNowPlaying()
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
            } catch {
                NSLog("artwork \(track.id): \(error.localizedDescription)")
            }
        }
    }

    private nonisolated static func makeArtwork(_ image: PlatformImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in image }
    }

    private nonisolated static var artworkDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("artwork", isDirectory: true)
    }

    private nonisolated static func artworkFile(_ id: String) -> URL {
        artworkDirectory.appendingPathComponent("\(id).jpg")
    }

    private func thumbnailChanged(_ id: String, _ thumbnail: String?) {
        for i in queue.indices where queue[i].id == id { queue[i].thumbnail = thumbnail }
        try? FileManager.default.removeItem(at: Self.artworkFile(id))
        guard current?.id == id else { return }
        artwork = nil
        artworkID = nil
        refreshArtwork()
        updateNowPlaying()
    }

    private nonisolated static func artworkImage(for track: Track) async throws -> PlatformImage? {
        let file = artworkFile(track.id)
        if let data = try? Data(contentsOf: file), let img = PlatformImage(data: data) { return img }
        try Task.checkCancellation()
        var data = try await embeddedArtwork(track.fileURL)
        try Task.checkCancellation()
        if data == nil, let source = track.thumbnail { data = try await remoteArtwork(source) }
        try Task.checkCancellation()
        guard let data, let img = PlatformImage(data: data) else { return nil }
        try? FileManager.default.createDirectory(at: artworkDirectory, withIntermediateDirectories: true)
        try? (img.jpegRepresentation(quality: 0.9) ?? data).write(to: file, options: .atomic)
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
        #if os(macOS)
        MPNowPlayingInfoCenter.default().playbackState = current == nil ? .stopped : (isPlaying ? .playing : .paused)
        #endif
        guard let track = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        let text: (title: String, artist: String) = nowPlayingText?(track) ?? (track.title, track.artist)
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: text.title,
            MPMediaItemPropertyArtist: text.artist,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let album = track.album, !album.isEmpty { info[MPMediaItemPropertyAlbumTitle] = album }
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
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
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
        #if os(macOS)
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(by: 10) }
            return .success
        }
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(by: -10) }
            return .success
        }
        #endif
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(to: event.positionTime) }
            return .success
        }
    }
}
