import AVFoundation
import Combine
import SwiftUI

extension Notification.Name {
    static let macRevealPlayingSong = Notification.Name("macRevealPlayingSong")
}

/// Port of the name rules in `web/js/credits.js` for songs that only carry the legacy fields.
enum SongName {
    private static func norm(_ s: String) -> String {
        s.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).joined(separator: " ")
    }

    private static func hidden(_ seen: String, _ part: String) -> Bool {
        let n = norm(part)
        return n.isEmpty || " \(seen) ".contains(" \(n) ")
    }

    static func remix(_ t: Track) -> String {
        let seen = norm(t.title)
        return Tokens.tokenize(t.remixer ?? "")
            .map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !hidden(seen, $0) }
            .joined(separator: ", ")
    }

    static func artistLine(_ t: Track) -> String { t.artist.trimmingCharacters(in: .whitespacesAndNewlines) }

    static func titleLine(_ t: Track) -> String {
        let r = remix(t)
        return r.isEmpty ? t.title : "\(t.title) (\(r))"
    }

    static func displayLine(_ t: Track) -> String {
        let a = artistLine(t)
        return a.isEmpty ? titleLine(t) : "\(a) - \(titleLine(t))"
    }

    static func subtitle(_ t: Track) -> String {
        [artistLine(t), t.year.map(String.init) ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func title(_ t: Track) -> Text {
        let r = remix(t)
        return r.isEmpty ? Text(t.title) : Text(t.title) + Text(" (\(r))").foregroundStyle(DS.Color.inkMuted)
    }
}

func macTime(_ seconds: Double) -> String {
    let s = Int(max(seconds.isFinite ? seconds : 0, 0))
    return String(format: "%d:%02d", s / 60, s % 60)
}

/// Streams from the server like the web, remembers the queue and volume, and surfaces playback problems as toasts.
@MainActor
final class MacPlayback: ObservableObject {
    static let shared = MacPlayback()

    @Published private(set) var toast: String?

    private static let queueKey = "ap2.queue"
    private static let volumeKey = "ap2.volume"
    private weak var player: PlayerService?
    private weak var settings: Settings?
    private weak var library: LibraryStore?
    private var installed = false
    private var restored = false
    private var bag = Set<AnyCancellable>()
    private var toastTask: Task<Void, Never>?
    private var skipped = 0

    private struct Saved: Codable {
        var ids: [String]
        var index: Int
        var tags: [String]
    }

    func install(player: PlayerService, settings: Settings, library: LibraryStore) {
        guard !installed else { return }
        installed = true
        self.player = player
        self.settings = settings
        self.library = library

        player.itemFactory = { [weak self] track, refresh in
            if let item = await self?.item(for: track, refresh: refresh) { return item }
            return AVPlayerItem(url: track.fileURL)
        }
        MacVisualizer.shared.install(player: player)
        player.nowPlayingText = { (SongName.titleLine($0), SongName.artistLine($0)) }

        if let v = UserDefaults.standard.object(forKey: Self.volumeKey) as? Double { player.volume = min(max(v, 0), 1) }
        player.$volume.dropFirst().sink { UserDefaults.standard.set($0, forKey: Self.volumeKey) }.store(in: &bag)

        library.$songs.sink { [weak self] songs in self?.restoreIfPossible(songs) }.store(in: &bag)

        Publishers.CombineLatest3(player.$queue, player.$index, player.$queueTags)
            .dropFirst()
            .sink { [weak self] queue, index, tags in self?.save(queue, index, tags) }
            .store(in: &bag)

        player.$failedTrackID.compactMap { $0 }.sink { [weak self] id in self?.playbackFailed(id) }.store(in: &bag)
        player.$position.sink { [weak self] p in if p > 0.5 { self?.skipped = 0 } }.store(in: &bag)

        Task { _ = await AuthService.shared.validToken() }
        Timer.publish(every: 300, on: .main, in: .common).autoconnect()
            .sink { _ in Task { _ = await AuthService.shared.validToken() } }
            .store(in: &bag)
    }

    func show(_ text: String, long: Bool = false) {
        toast = text
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(long ? 6 : 3))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    private func item(for track: Track, refresh: Bool) async -> AVPlayerItem {
        let item = await makeItem(for: track, refresh: refresh)
        await MacVisualizer.shared.prepare(item)
        return item
    }

    private func makeItem(for track: Track, refresh: Bool) async -> AVPlayerItem {
        if FileManager.default.fileExists(atPath: track.fileURL.path) { return AVPlayerItem(url: track.fileURL) }
        guard let settings, var c = URLComponents(string: settings.serverURL) else { return AVPlayerItem(url: track.fileURL) }
        c.path = Endpoints.file(track.id)
        guard let url = c.url else { return AVPlayerItem(url: track.fileURL) }
        var headers: [String: String] = [:]
        let token = refresh ? await AuthService.shared.refreshedToken() : await AuthService.shared.validToken()
        if let token {
            headers["Authorization"] = "Bearer \(token)"
        } else if !settings.token.isEmpty {
            headers["X-API-Token"] = settings.token
        }
        let asset = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
        return AVPlayerItem(asset: asset)
    }

    private func playbackFailed(_ id: String) {
        guard let player else { return }
        let missing = player.queue.first { $0.id == id }?.onServer == false
        guard missing, player.hasNext, skipped < player.queue.count else {
            show(missing ? "No more downloaded songs in the playlist" : "Cannot play this song")
            return
        }
        skipped += 1
        show("Skipped \(skipped) not downloaded")
        player.next()
    }

    private func save(_ queue: [Track], _ index: Int?, _ tags: [String]) {
        guard restored else { return }
        let saved = Saved(ids: queue.map(\.id), index: index ?? 0, tags: tags)
        if let data = try? JSONEncoder().encode(saved) { UserDefaults.standard.set(data, forKey: Self.queueKey) }
    }

    private func restoreIfPossible(_ songs: [Track]) {
        guard !restored, let player, !songs.isEmpty else { return }
        restored = true
        guard player.index == nil, let data = UserDefaults.standard.data(forKey: Self.queueKey),
              let saved = try? JSONDecoder().decode(Saved.self, from: data) else { return }
        let byID = Dictionary(songs.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let tracks = saved.ids.compactMap { byID[$0] }
        guard !tracks.isEmpty else { return }
        let current = saved.ids.indices.contains(saved.index) ? saved.ids[saved.index] : nil
        player.restore(tracks, index: tracks.firstIndex { $0.id == current } ?? 0, tags: saved.tags)
    }
}
