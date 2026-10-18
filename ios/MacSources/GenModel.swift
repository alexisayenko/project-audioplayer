import AppKit
import SwiftUI

struct GenTip: Equatable {
    var text: String
    var x: Double
    var y: Double
}

enum GenNowKind { case idle, none, unmapped, ready }

/// Port of `createNowSelection` in `web/js/genre-playing.js`: a toggled multi-selection that follows the playing song.
final class GenNowSelection {
    private(set) var active = false
    private var busy = false
    private var key = ""
    private let setSelection: ([String]) -> Void
    private let clearSelection: () -> Void

    init(set: @escaping ([String]) -> Void, clear: @escaping () -> Void) {
        setSelection = set
        clearSelection = clear
    }

    private func apply(_ ids: [String]) {
        busy = true
        setSelection(ids)
        busy = false
    }

    private func drop() {
        active = false
        busy = true
        clearSelection()
        busy = false
    }

    @discardableResult
    func toggle(_ ids: [String]) -> Bool {
        if active { drop(); return false }
        if ids.isEmpty { return false }
        active = true
        key = ids.joined(separator: "|")
        apply(ids)
        return true
    }

    func songChanged(_ ids: [String]) {
        guard active else { return }
        if ids.isEmpty { drop(); return }
        let k = ids.joined(separator: "|")
        if k == key { return }
        key = k
        apply(ids)
    }

    func userSelected() -> Bool {
        if busy { return false }
        let was = active
        active = false
        return was
    }
}

/// Per-frame state kept apart from `GenModel` so mouse moves do not rebuild the outline and panels.
@MainActor
final class GenFrameState: ObservableObject {
    @Published var tip: GenTip?
    @Published var redraw = 0
}

@MainActor
final class GenModel: ObservableObject {
    let engine: GenEngine
    let frame = GenFrameState()
    @Published private(set) var graph: GenGraph?
    @Published private(set) var rev = 0
    @Published private(set) var message = "Loading genres..."
    @Published private(set) var selection: [String] = []
    @Published private(set) var hidden = Set<String>()
    @Published var legendOpen = false
    @Published private(set) var nowOpen = false
    @Published private(set) var orphOpen = false
    @Published private(set) var outlineOpen: Bool
    @Published private(set) var expanded: Set<String>
    @Published var query = ""
    @Published private(set) var nowItems: [GenSongGenre] = []
    @Published private(set) var nowKind = GenNowKind.idle
    @Published private(set) var nowHint = "Nothing playing"
    @Published private(set) var nowPressed = false
    @Published private(set) var orphPressed = false
    @Published private(set) var orphans: [GenNode] = []
    @Published private(set) var announcement = ""

    private static let outlineKey = "electrophone.genresOutline"
    private static let panelKey = "electrophone.genresPanel"
    private(set) var songs: [Track] = []
    private(set) var currentSong: Track?
    private var nowSel: GenNowSelection!
    private var orphSel: GenNowSelection!

    var selectedID: String? { selection.count == 1 ? selection[0] : nil }
    var selectedNode: GenNode? { selectedID.flatMap { graph?[$0] } }

    init() {
        engine = GenEngine(reduced: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
        let d = UserDefaults.standard
        outlineOpen = d.object(forKey: Self.panelKey) == nil ? true : d.string(forKey: Self.panelKey) == "1"
        if let raw = d.array(forKey: Self.outlineKey) as? [String] { expanded = Set(raw) }
        else { expanded = Set(GenFamily.all.map { "f:\($0)" }) }
        engine.onSelect = { [weak self] ids in self?.selectionChanged(ids) }
        engine.onRedraw = { [weak self] in self?.frame.redraw &+= 1 }
        engine.onHover = { [weak self] id, p in self?.hovered(id, p) }
        nowSel = GenNowSelection(
            set: { [weak self] ids in self?.engine.selectMany(ids, ancestors: true); self?.announceNow(ids.count, orphans: false) },
            clear: { [weak self] in self?.engine.select(nil) })
        orphSel = GenNowSelection(
            set: { [weak self] ids in self?.engine.selectMany(ids); self?.announceNow(ids.count, orphans: true) },
            clear: { [weak self] in self?.engine.select(nil) })
    }

    private func announceNow(_ n: Int, orphans: Bool) {
        let g = "\(n) \(n == 1 ? "genre" : "genres")"
        announcement = orphans ? "Selected \(g) with no connections" : "Selected \(g) of the playing song"
    }

    // MARK: engine events

    private func selectionChanged(_ ids: [String]) {
        selection = ids
        if nowSel.userSelected(), nowOpen { setNow(false) }
        if orphSel.userSelected() { setOrph(false) }
        revealInOutline()
    }

    private func hovered(_ id: String?, _ p: CGPoint) {
        guard let id, let n = graph?[id] else { if frame.tip != nil { frame.tip = nil }; return }
        let t = GenTip(text: "\(n.label) - \(Self.songsText(n.count))", x: p.x + 14, y: p.y + 14)
        if frame.tip != t { frame.tip = t }
    }

    static func songsText(_ n: Int) -> String { "\(n) \(n == 1 ? "song" : "songs")" }

    // MARK: loading

    func load(settings: Settings, library: [Track]) async {
        songs = library
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        var polls = 0
        while !Task.isCancelled {
            var wire: GenWire?
            var failed = false
            do { wire = try JSONDecoder().decode(GenWire.self, from: try await api.fetch(Endpoints.genres + "/graph")) }
            catch { failed = true }
            if Task.isCancelled { return }
            if !failed, let wire, !(wire.nodes ?? []).isEmpty {
                let pending = (wire.pending ?? false) && polls < 24
                var text = "Genre data unavailable - showing your tags only"
                if wire.ontology ?? false { text = pending ? "Resolving genre families..." : "" }
                apply(GenGraph(wire: wire), text)
                if pending {
                    polls += 1
                    try? await Task.sleep(for: .seconds(5))
                    continue
                }
                return
            }
            if !failed, !songs.contains(where: { !genTrackGenres($0).isEmpty }) {
                apply(GenGraph(nodes: []), "No genres yet - add songs with genre tags")
                return
            }
            apply(genFlatGraph(songs), "Genre data unavailable - showing your tags only")
            return
        }
    }

    private func apply(_ g: GenGraph, _ text: String) {
        if !songs.isEmpty { g.applyCounts(g.localCounts(songs)) }
        graph = g
        message = text
        engine.update(g)
        if let id = selectedID, g[id] == nil { selection = [] }
        rev &+= 1
        revealInOutline()
        refreshNow()
        refreshOrph()
    }

    func libraryChanged(_ tracks: [Track]) {
        songs = tracks
        guard let g = graph else { return }
        g.applyCounts(g.localCounts(tracks))
        engine.update(g)
        rev &+= 1
        refreshNow()
        refreshOrph()
    }

    func songChanged(_ t: Track?) {
        currentSong = t
        refreshNow()
    }

    // MARK: songs of a genre

    func songs(of id: String) -> [Track] {
        guard let g = graph else { return [] }
        let tags = Set(g.filterTags(id))
        return songs.filter { t in genTrackGenres(t).contains { tags.contains("genre:\($0.key)") } }
    }

    // MARK: outline

    func setOutline(_ open: Bool) {
        outlineOpen = open
        UserDefaults.standard.set(open ? "1" : "0", forKey: Self.panelKey)
        if open { revealInOutline() }
    }

    func toggleExpanded(_ key: String) {
        if expanded.contains(key) { expanded.remove(key) } else { expanded.insert(key) }
        saveExpanded()
    }

    private func saveExpanded() {
        UserDefaults.standard.set(Array(expanded.sorted().prefix(500)), forKey: Self.outlineKey)
    }

    private func revealInOutline() {
        guard let g = graph, let id = selectedID else { return }
        var changed = false
        for k in g.pathKeys(id).dropLast() where !expanded.contains(k) { expanded.insert(k); changed = true }
        if changed { saveExpanded() }
    }

    // MARK: actions

    func pick(_ id: String) {
        query = ""
        engine.select(id, center: true)
    }

    func toggleHidden(_ family: String) {
        if hidden.contains(family) { hidden.remove(family) } else { hidden.insert(family) }
        engine.setHiddenFamilies(hidden)
    }

    func showAllFamilies() {
        hidden = []
        engine.setHiddenFamilies(hidden)
    }

    func escape() {
        if orphOpen || orphSel.active { closeOrph() }
        else if nowOpen || nowSel.active { closeNow() }
        else if outlineOpen { setOutline(false) }
    }

    // MARK: Now playing

    private var nowIDs: [String] {
        guard let g = graph else { return [] }
        return Self.nodeIDs(g.map(genTrackGenres(currentSong)))
    }

    static func nodeIDs(_ items: [GenSongGenre]) -> [String] {
        var seen = Set<String>()
        return items.compactMap(\.nodeID).filter { seen.insert($0).inserted }
    }

    func toggleNow() {
        if orphOpen || orphSel.active { if orphSel.active { orphSel.toggle([]) }; setOrph(false) }
        if nowOpen || nowSel.active { closeNow(); return }
        nowSel.toggle(nowIDs)
        setNow(true)
    }

    func closeNow() {
        if nowSel.active { nowSel.toggle([]) }
        setNow(false)
    }

    private func setNow(_ open: Bool) {
        nowOpen = open
        refreshNow()
    }

    func refreshNow() {
        let song = currentSong
        let genres = genTrackGenres(song)
        let items = graph.map { $0.map(genres) } ?? genres.map { GenSongGenre(key: $0.key, label: $0.label, nodeID: nil) }
        if song == nil { nowKind = .idle; nowHint = "Nothing playing" }
        else if items.isEmpty { nowKind = .none; nowHint = "No genres for this song" }
        else if Self.nodeIDs(items).isEmpty { nowKind = .unmapped; nowHint = "None of this song's genres are on the map" }
        else { nowKind = .ready; nowHint = "Select the genres of the playing song" }
        let wasActive = nowSel.active
        nowSel.songChanged(Self.nodeIDs(items))
        if wasActive, !nowSel.active { nowOpen = false }
        nowPressed = nowSel.active
        if nowKind != .ready, nowOpen { nowOpen = false }
        engine.setMarked(nowOpen ? Self.nodeIDs(items) : [])
        nowItems = items
    }

    // MARK: Orphans

    func toggleOrph() {
        if orphOpen || orphSel.active { closeOrph(); return }
        if nowOpen || nowSel.active { if nowSel.active { nowSel.toggle([]) }; setNow(false) }
        if orphSel.toggle(orphans.map(\.id)) { setOrph(true) }
    }

    func closeOrph() {
        if orphSel.active { orphSel.toggle([]) }
        setOrph(false)
    }

    private func setOrph(_ open: Bool) {
        orphOpen = open
        refreshOrph()
    }

    func refreshOrph() {
        let list = graph?.orphans() ?? []
        orphans = list
        if orphSel.active { orphSel.songChanged(list.map(\.id)) }
        if !orphSel.active { orphOpen = false }
        if list.isEmpty { orphOpen = false }
        orphPressed = orphOpen
    }

    var orphLabel: String { orphans.isEmpty ? "Orphans" : "Orphans \(orphans.count)" }
    var orphHint: String { orphans.isEmpty ? "No orphan genres" : "Genres with no connections" }
}
