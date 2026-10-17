import AppKit
import SwiftUI

/// Native Genres map: the force-directed genre graph of `#/genres` with toolbar, legend, Now playing, Orphans, outline and the selected-genre card.
struct GenresMapPage: View {
    @StateObject private var model = GenModel()
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var auth: AuthService

    private let gap = DS.Space.space3

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                GenCanvasView(engine: model.engine, frame: model.frame, escape: model.escape)
                leftColumn(width: barWidth(geo.size.width))
                    .padding(gap)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                GenZoomBar(engine: model.engine)
                    .padding(gap)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                right
                    .padding(gap)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                info
                    .padding(gap)
                    .padding(.bottom, model.outlineOpen ? 132 : 0)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: model.outlineOpen ? .bottomLeading : .bottomTrailing)
            }
        }
        .background(DS.Color.surface)
        .clipped()
        .navigationTitle("Genres map")
        .onKeyPress(.escape) { model.escape(); return .handled }
        .task(id: "\(settings.serverURL)|\(auth.session?.email ?? "")") {
            await model.load(settings: settings, library: library.songs)
        }
        .onAppear { model.songChanged(player.current) }
        .onChange(of: library.songs) { _, songs in model.libraryChanged(songs) }
        .onChange(of: player.current) { _, song in model.songChanged(song) }
        .onChange(of: model.announcement) { _, text in
            guard !text.isEmpty else { return }
            NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested, userInfo: [.announcement: text])
        }
    }

    private func barWidth(_ total: CGFloat) -> CGFloat {
        let reserved: CGFloat = model.outlineOpen ? 360 + 3 * 12 : 96 + 2 * 12
        return max(280, min(456, total - reserved))
    }

    private func leftColumn(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            GenBar(model: model)
                .background(GeometryReader { g in
                    Color.clear
                        .onAppear { model.engine.setInsets(top: gap + g.size.height) }
                        .onChange(of: g.size.height) { _, h in model.engine.setInsets(top: gap + h) }
                })
            if model.nowOpen { GenNowCard(model: model, song: player.current) }
            if model.orphOpen { GenOrphanCard(model: model) }
        }
        .frame(width: width)
    }

    @ViewBuilder private var right: some View {
        if model.outlineOpen {
            GenOutline(model: model)
        } else {
            Button { model.setOutline(true) } label: {
                Label("Outline", systemImage: "list.bullet.indent").font(T.subhead).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, DS.Space.space4).frame(minHeight: 36)
                    .genCard()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Show the outline")
            .accessibilityLabel("Outline")
        }
    }

    @ViewBuilder private var info: some View {
        if let n = model.selectedNode { GenInfoPanel(model: model, node: n) }
    }
}
