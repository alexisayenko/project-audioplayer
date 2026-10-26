import Combine
import Foundation

/// What survives a relaunch: the queue, the current song and where it stood (IOS-104, web PLY-179).
struct SavedPlayback: Codable, Equatable {
    var ids: [String]
    var index: Int
    var tags: [String]
    var position: Double?
}

enum ResumePosition {
    static let minStart = 3.0
    static let endGuard = 5.0

    /// The position to seek to after a relaunch: the saved one when it is above 3 s and at least 5 s before the end, else 0.
    static func start(saved: Double?, duration: Double?) -> Double {
        guard let saved, saved.isFinite, saved > minStart else { return 0 }
        if let duration, duration.isFinite, duration > 0, saved > duration - endGuard { return 0 }
        return saved
    }
}

/// Decides when a playing position is written: at most every 5 s while playing, at once when not playing (pause, seek).
struct ResumeCheckpoint {
    static let interval: TimeInterval = 5
    private var lastWrite: Date?

    mutating func due(now: Date, playing: Bool) -> Bool {
        if playing, let lastWrite, now.timeIntervalSince(lastWrite) < Self.interval { return false }
        lastWrite = now
        return true
    }
}

/// Keeps the queue and the playback position in `UserDefaults` and puts them back at launch with the song cued and paused.
@MainActor
final class PlaybackPersistence {
    static let shared = PlaybackPersistence()
    static let key = "ap2.queue"

    private let defaults: UserDefaults
    private let now: () -> Date
    private weak var player: PlayerService?
    private var isPlayable: (Track) -> Bool = { _ in true }
    private var restored = false
    private var checkpoint = ResumeCheckpoint()
    private var savedID: String?
    private var lastPosition: Double?
    private var bag = Set<AnyCancellable>()

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
    }

    /// Starts restoring and saving. `isPlayable` drops saved songs that cannot play now (audio no longer on the phone).
    func install(player: PlayerService, library: LibraryStore, isPlayable: @escaping (Track) -> Bool = { _ in true }) {
        guard self.player == nil else { return }
        self.player = player
        self.isPlayable = isPlayable
        library.$songs.sink { [weak self] songs in self?.restoreIfPossible(songs) }.store(in: &bag)
        Publishers.CombineLatest3(player.$queue, player.$index, player.$queueTags)
            .dropFirst()
            .sink { [weak self] queue, index, tags in self?.queueChanged(queue, index, tags) }
            .store(in: &bag)
        player.clock.$position
            .sink { [weak self] position in self?.positionChanged(position) }
            .store(in: &bag)
        player.$isPlaying.dropFirst().filter { !$0 }
            .sink { [weak self] _ in self?.saveNow() }
            .store(in: &bag)
        for name in [AppLifecycle.didEnterBackground, AppLifecycle.willTerminate] {
            NotificationCenter.default.publisher(for: name)
                .sink { [weak self] _ in self?.saveNow() }
                .store(in: &bag)
        }
    }

    func saved() -> SavedPlayback? {
        guard let data = defaults.data(forKey: Self.key) else { return nil }
        return try? JSONDecoder().decode(SavedPlayback.self, from: data)
    }

    private func write(_ value: SavedPlayback) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: Self.key) }
    }

    private func queueChanged(_ queue: [Track], _ index: Int?, _ tags: [String]) {
        guard restored else { return }
        let id = index.flatMap { queue.indices.contains($0) ? queue[$0].id : nil }
        let sameSong = id != nil && id == savedID
        savedID = id
        let position = sameSong ? player?.clock.position : 0
        lastPosition = position
        write(SavedPlayback(ids: queue.map(\.id), index: index ?? 0, tags: tags, position: position))
    }

    private func positionChanged(_ position: Double) {
        guard restored, let player, position != lastPosition else { return }
        guard checkpoint.due(now: now(), playing: player.isPlaying) else { return }
        store(position)
    }

    private func saveNow() {
        guard restored, let player else { return }
        store(player.clock.position)
    }

    private func store(_ position: Double) {
        guard let player else { return }
        lastPosition = position
        write(SavedPlayback(ids: player.queue.map(\.id), index: player.index ?? 0, tags: player.queueTags, position: position))
    }

    private func restoreIfPossible(_ songs: [Track]) {
        guard !restored, let player, !songs.isEmpty else { return }
        if player.index == nil, let saved = saved() { restore(saved, songs: songs, into: player) }
        restored = true
        savedID = player.current?.id
        if player.current != nil { store(player.clock.position) }
    }

    private func restore(_ saved: SavedPlayback, songs: [Track], into player: PlayerService) {
        let byID = Dictionary(songs.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let tracks = saved.ids.compactMap { byID[$0] }.filter(isPlayable)
        guard !tracks.isEmpty else { return }
        let wanted = saved.ids.indices.contains(saved.index) ? saved.ids[saved.index] : nil
        let found = tracks.firstIndex { $0.id == wanted }
        let position = found.map { ResumePosition.start(saved: saved.position, duration: tracks[$0].duration) } ?? 0
        player.restore(tracks, index: found ?? 0, tags: saved.tags, position: position)
    }
}
