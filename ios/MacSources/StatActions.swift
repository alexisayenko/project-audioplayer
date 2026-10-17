import SwiftUI

/// Play and queue actions for songs picked on the chart; same behaviour and wording as the web's `playListed` / `addListed`.
@MainActor
struct StatActions {
    let library: LibraryStore
    let player: PlayerService
    let settings: Settings
    let server: ServerLink
    let ui: LibraryUIState

    func hasAudio(_ t: Track) -> Bool { library.contains(t.id) || (t.onServer ?? true) }

    private func plural(_ n: Int) -> String { n == 1 ? "song" : "songs" }

    private func fetchMissing(_ list: [Track]) {
        for t in list where !hasAudio(t) { ui.fetch(t, settings: settings, library: library, server: server, player: player) }
    }

    private func audible(_ list: [Track]) -> [Track] {
        var seen = Set<String>()
        return list.filter { hasAudio($0) && seen.insert($0.id).inserted }
    }

    func play(_ t: Track) {
        guard hasAudio(t) else { fetch(t, play: true); return }
        player.playNow(t)
    }

    func cover(_ t: Track) {
        if player.current?.id == t.id { player.toggle() } else { play(t) }
    }

    func fetch(_ t: Track, play: Bool) {
        if ui.fetches[t.id]?.phase == .failed { ui.dismissFailure(t.id) }
        ui.fetch(t, play: play, settings: settings, library: library, server: server, player: player)
        ui.toast = "Downloading \"\(t.title)\" to the server"
    }

    func toggleQueue(_ t: Track) {
        if let i = player.queue.firstIndex(where: { $0.id == t.id }) {
            player.removeFromQueue(at: IndexSet(integer: i))
            ui.toast = "Removed from playlist"
        } else if hasAudio(t) {
            player.enqueue([t])
            ui.toast = player.queue.count == 1 ? "Queued" : "Added"
        } else if ui.autoDownload {
            fetch(t, play: false)
        } else {
            ui.toast = "Not downloaded. Use Download to the server first."
        }
    }

    func playAll(_ list: [Track]) {
        let ready = audible(list)
        let none = list.count - ready.count
        guard !ready.isEmpty else { ui.toast = "Nothing to play"; return }
        let upcoming = player.index.map { player.queue.count - $0 - 1 } ?? 0
        player.play(ready, startAt: player.shuffle ? Int.random(in: 0..<ready.count) : 0)
        var msg = "Playing \(ready.count) \(plural(ready.count))"
        if upcoming > 0 { msg += " (queue replaced)" }
        if none > 0 {
            if ui.autoDownload { fetchMissing(list); msg += ", \(none) downloading" }
            else { msg += ", \(none) without audio skipped" }
        }
        ui.toast = msg
    }

    func addAll(_ list: [Track]) {
        let ready = audible(list)
        let before = player.queue.count
        player.enqueue(ready)
        let added = player.queue.count - before
        let rest = list.count - ready.count
        var msg = "Added \(added) \(plural(added))"
        if rest > 0, ui.autoDownload { fetchMissing(list); msg += ", \(rest) downloading" }
        if ready.count > added { msg += " (\(ready.count - added) already in queue)" }
        ui.toast = msg
    }
}
