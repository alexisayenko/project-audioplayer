import AVFoundation
import MediaPlayer

/// Plays a queue of local tracks with background audio and lock-screen controls.
@MainActor
final class PlayerService: ObservableObject {
    @Published private(set) var queue: [Track] = []
    @Published private(set) var index: Int?
    @Published private(set) var isPlaying = false
    @Published private(set) var position: Double = 0
    @Published private(set) var duration: Double = 0

    @Published var volume: Double = 1 { didSet { player.volume = Float(volume) } }

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

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
        load(start)
    }

    func playNext(_ track: Track) {
        guard let index else { return play([track], startAt: 0) }
        queue.removeAll { $0.id == track.id && $0.id != current?.id }
        let at = (queue.firstIndex { $0.id == current?.id } ?? index) + 1
        queue.insert(track, at: min(at, queue.count))
    }

    @discardableResult
    func enqueue(_ tracks: [Track]) -> Int {
        let fresh = tracks.filter { t in !queue.contains { $0.id == t.id } }
        queue.append(contentsOf: fresh)
        return fresh.count
    }

    func jump(to i: Int) { load(i) }

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

    func next() {
        guard let index, index + 1 < queue.count else { return pause() }
        load(index + 1)
    }

    func previous() {
        guard let index else { return }
        if position > 3 || index == 0 { seek(to: 0) } else { load(index - 1) }
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        position = seconds
        updateNowPlaying()
    }

    private func load(_ i: Int) {
        guard queue.indices.contains(i) else { return }
        index = i
        let item = AVPlayerItem(url: queue[i].fileURL)
        player.replaceCurrentItem(with: item)
        duration = queue[i].duration ?? 0
        position = 0
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.next() } }
        resume()
    }

    private func updateNowPlaying() {
        guard let track = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
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
