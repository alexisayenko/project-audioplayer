import AppKit
import SwiftUI

struct SongStatsPage: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @ObservedObject private var ui = LibraryUIState.shared
    @StateObject private var model = StatChartModel()
    @AppStorage("stats.color") private var modeRaw = StatMode.family.rawValue
    @AppStorage("ap2.panel.stats") private var collapsed = false
    @State private var groups: [StatGroup] = []
    @State private var hidden: Set<String> = []
    @State private var skipped = 0
    @State private var legendOpen = true
    @State private var asTable = false
    @State private var resolver: StatData.Resolver?
    @State private var graphFailed = false
    @State private var families: [String: String]?
    @State private var barHeight = 0.0
    @State private var card: Track?
    @State private var form: SongFormTarget?

    private var mode: StatMode { StatMode(rawValue: modeRaw) ?? .family }
    private var modeBinding: Binding<StatMode> { Binding(get: { mode }, set: { modeRaw = $0.rawValue; hidden = [] }) }
    private var loaded: Bool { !library.songs.isEmpty || server.synced }
    private var resolving: Bool { mode == .family && families == nil }
    private var actions: StatActions { StatActions(library: library, player: player, settings: settings, server: server, ui: ui) }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                stage
                bar
                    .padding(DS.Space.space3)
                    .onGeometryChange(for: Double.self, of: { Double($0.size.height) }) { h in
                        barHeight = h
                        model.setInsetTop(h + 8)
                    }
                StatOverlayHost(model: model, overlay: model.overlay, families: families)
                    .allowsHitTesting(false)
                selection
            }
            .onChange(of: geo.size, initial: true) { _, s in model.setSize(s) }
        }
        .background(DS.Color.surface)
        .navigationTitle("Song stats")
        .libToast($ui.toast)
        .sheet(item: $card) { t in
            LibSongCard(trackID: t.id, callbacks: callbacks, close: { card = nil }, edit: { card = nil; form = .edit($0) })
        }
        .sheet(item: $form) { MacSongFormSheet(target: $0) }
        .onAppear {
            model.onOpen = { p in card = p.track }
            model.onFocus = { p in announce(p) }
            rebuild()
        }
        .onChange(of: library.songs) { rebuild() }
        .onChange(of: library.phoneIDs) { if mode == .audio { rebuild() } }
        .onChange(of: modeRaw) { rebuild() }
        .onChange(of: asTable) { model.cancelDrag() }
        .task(id: modeRaw) { if mode == .family { await resolveGraph() } }
    }

    private var callbacks: LibRowCallbacks {
        LibRowCallbacks(
            playNow: { actions.play($0) },
            coverTap: { actions.cover($0) },
            open: { card = $0 },
            toggleQueue: { actions.toggleQueue($0) },
            fetch: { actions.fetch($0, play: false) },
            edit: { form = .edit($0) })
    }

    private var stage: some View {
        ZStack {
            if asTable {
                StatTable(rows: tableRows, topInset: barHeight) { card = $0 }
            } else {
                StatBaseLayer(model: model)
                StatTopLayer(model: model, overlay: model.overlay)
                StatInput(model: model, label: StatData.chartLabel(model.points.count))
            }
            if model.points.isEmpty {
                Text(loaded ? "Songs need a year and a BPM to appear here" : "Loading songs...")
                    .font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted)
                    .multilineTextAlignment(.center).padding(DS.Space.space4)
                    .allowsHitTesting(false)
            }
        }
    }

    private var bar: some View {
        StatBar(
            mode: modeBinding, legendOpen: $legendOpen, asTable: $asTable, collapsed: $collapsed,
            status: loaded ? StatData.countText(model.points.count, library.songs.count) : "",
            note: StatData.skippedText(skipped), groups: groups, hidden: hidden, resolving: resolving,
            zoomed: model.zoomed, family: mode == .family,
            toggle: toggleGroup, center: { model.center() }, reset: { model.reset() })
    }

    @ViewBuilder private var selection: some View {
        StatSelectionHost(overlay: model.overlay) { count in
            StatSelectionPanel(count: count, clear: { model.clearSelection() }, add: { actions.addAll(selectedSongs) }, play: { actions.playAll(selectedSongs) })
                .padding(.bottom, DS.Space.space4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }

    private var selectedSongs: [Track] {
        model.points.filter { model.overlay.selected.contains($0.id) }.map(\.track)
    }

    private var tableRows: [StatRow] {
        model.points.filter { !hidden.contains($0.group) }.map { p in
            StatRow(id: p.id, track: p.track, title: SongName.titleLine(p.track), artist: SongName.artistLine(p.track), year: p.year,
                    bpm: p.bpm, decade: StatData.decade(p.year), family: families.map { $0[p.id] ?? StatData.other } ?? "")
        }
    }

    private func announce(_ p: StatPoint) {
        let artist = SongName.artistLine(p.track)
        let text = "\(SongName.titleLine(p.track)), \(artist.isEmpty ? "unknown artist" : artist), \(p.year), \(Int(p.bpm.rounded())) BPM"
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                             userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.medium.rawValue])
    }

    private func toggleGroup(_ key: String) {
        if hidden.contains(key) { hidden.remove(key) } else { hidden.insert(key) }
        model.setHidden(hidden)
    }

    private func computeGroups(keepView: Bool) {
        families = mode == .family ? StatData.families(resolver, library.songs, failed: graphFailed) : nil
        var pts = keepView ? model.points : StatData.split(library.songs).plotted.map(StatData.makePoint)
        groups = StatData.assign(&pts, mode: mode, families: families, hasAudio: actions.hasAudio)
        let keys = Set(groups.map(\.key))
        hidden = hidden.filter { keys.contains($0) }
        if keepView { model.recolor(pts, hidden: hidden, familyPalette: mode == .family) }
        else { model.setData(pts, hidden: hidden, familyPalette: mode == .family) }
    }

    private func rebuild() {
        skipped = StatData.split(library.songs).skipped
        computeGroups(keepView: false)
    }

    private func resolveGraph() async {
        guard resolver == nil, !graphFailed else { return }
        let api = APIClient(baseURL: settings.serverURL, token: settings.token)
        var polls = 0
        while !Task.isCancelled {
            var decoded: StatGraph?
            if let data = try? await api.fetch(Endpoints.genresGraph) { decoded = try? JSONDecoder().decode(StatGraph.self, from: data) }
            let usable = !(decoded?.nodes ?? []).isEmpty
            if usable, let decoded { resolver = StatData.Resolver(decoded) }
            let pending = (decoded?.pending ?? false) && polls < 24
            if !usable && !pending && resolver == nil { graphFailed = true }
            if mode == .family { computeGroups(keepView: true) }
            guard pending else { return }
            polls += 1
            try? await Task.sleep(for: .seconds(5))
        }
    }
}

/// Tooltip for the hovered dot; observes the overlay so the page itself does not redraw on every mouse move.
private struct StatOverlayHost: View {
    @ObservedObject var model: StatChartModel
    @ObservedObject var overlay: StatOverlay
    let families: [String: String]?

    var body: some View {
        GeometryReader { geo in
            if let h = overlay.hover, model.points.indices.contains(h) {
                let p = model.points[h]
                let left = overlay.hoverPos.x + 14
                StatTooltip(track: p.track, year: p.year, bpm: p.bpm, genres: genres(p))
                    .fixedSize()
                    .offset(x: left > geo.size.width - 220 ? overlay.hoverPos.x - 220 : left, y: overlay.hoverPos.y + 14)
            }
        }
    }

    private func genres(_ p: StatPoint) -> String {
        let labels = StatData.genres(p.track).map(\.label).joined(separator: ", ")
        let fam = families.map { $0[p.id] ?? StatData.other } ?? ""
        return [fam, labels].filter { !$0.isEmpty }.joined(separator: ": ")
    }
}

private struct StatSelectionHost<Content: View>: View {
    @ObservedObject var overlay: StatOverlay
    @ViewBuilder let content: (Int) -> Content

    var body: some View {
        if !overlay.selected.isEmpty { content(overlay.selected.count) }
    }
}
