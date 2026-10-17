import SwiftUI

/// Selected genre (GEN-014): name, Wikipedia, family and counts, subgenres, "Show N songs in Library", and its songs to play.
struct GenInfoPanel: View {
    @ObservedObject var model: GenModel
    let node: GenNode
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @EnvironmentObject var nav: MacNavigation
    @AppStorage("ap2.panel.genreInfo") private var collapsed = false
    @ObservedObject private var ui = LibraryUIState.shared
    private let childChips = 12

    private var kids: [String] { model.graph?.children[node.id] ?? [] }
    private func hasAudio(_ t: Track) -> Bool { library.contains(t.id) || (t.onServer ?? true) }

    var body: some View {
        let songs = model.songs(of: node.id)
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            HStack(spacing: DS.Space.space2) {
                GenDot(family: node.family)
                Text(node.label).font(DS.Font.headline).foregroundStyle(DS.Color.ink).fixedSize(horizontal: false, vertical: true)
                wiki
                Spacer(minLength: 0)
                GenCollapseButton(collapsed: $collapsed)
                Button { model.engine.select(nil) } label: { Image(systemName: "xmark") }
                    .buttonStyle(GenIconButtonStyle()).help("Close").accessibilityLabel("Close")
            }
            Text("\(node.family) · \(GenModel.songsText(node.count))\(node.ownCount != node.count ? " (\(node.ownCount) tagged exactly)" : "")").dsCaption()
            if !collapsed {
                if !kids.isEmpty { subgenres }
                Button { showInLibrary() } label: { Text("Show \(GenModel.songsText(node.count)) in Library") }
                    .buttonStyle(LibLitButtonStyle()).disabled(node.count == 0)
                if !songs.isEmpty { songList(songs) }
            }
        }
        .padding(DS.Space.space4)
        .frame(width: 320)
        .genCard()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selected genre")
    }

    @ViewBuilder private var wiki: some View {
        if let w = node.wikipedia, let url = URL(string: w) {
            ServiceIcon(kind: .wikipedia, active: true, url: url, size: 16).help("Open on Wikipedia")
        } else if let q = node.qid, let url = URL(string: "https://www.wikidata.org/wiki/\(q)") {
            ServiceIcon(kind: .wikipedia, active: true, url: url, size: 16).opacity(0.4).help("Open on Wikidata (no Wikipedia article)")
        }
    }

    private var subgenres: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            Text("SUBGENRES").font(DS.Font.eyebrow).tracking(DS.Font.eyebrowTracking).foregroundStyle(DS.Color.inkMuted)
            FlowLayout(spacing: DS.Space.space1) {
                ForEach(kids.prefix(childChips).compactMap { model.graph?[$0] }) { c in
                    Button { model.engine.select(c.id, center: true) } label: {
                        Text(c.label).font(T.caption).foregroundStyle(DS.Color.accentInk)
                            .padding(.horizontal, DS.Space.space3).frame(minHeight: 28)
                            .background(Capsule().fill(DS.Color.accentTint))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if kids.count > childChips { Text("+\(kids.count - childChips) more").dsCaption() }
            }
        }
    }

    private func songList(_ songs: [Track]) -> some View {
        let audible = songs.filter(hasAudio)
        return VStack(alignment: .leading, spacing: DS.Space.space2) {
            HStack {
                Text("SONGS").font(DS.Font.eyebrow).tracking(DS.Font.eyebrowTracking).foregroundStyle(DS.Color.inkMuted)
                Spacer()
                Button { play(audible, from: nil) } label: { Label("Play all", systemImage: "play.fill") }
                    .buttonStyle(GenToolButtonStyle()).disabled(audible.isEmpty)
                    .help(audible.isEmpty ? "No songs with audio on the server" : "Play every song of this genre")
            }
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(songs) { t in
                        let ok = hasAudio(t)
                        Button { play(audible, from: t) } label: {
                            HStack(spacing: DS.Space.space2) {
                                LibCover(source: t.thumbnail, radius: DS.Radius.radiusXs).frame(width: 32, height: 32)
                                VStack(alignment: .leading, spacing: 0) {
                                    SongName.title(t).font(T.subhead).foregroundStyle(DS.Color.ink).lineLimit(1)
                                    Text(SongName.subtitle(t)).font(DS.Font.micro).foregroundStyle(DS.Color.inkMuted).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                if player.current?.id == t.id { Image(systemName: "speaker.wave.2.fill").font(.system(size: 11)).foregroundStyle(DS.Color.accentInk) }
                            }
                            .padding(.horizontal, DS.Space.space1).frame(minHeight: 36)
                            .opacity(ok ? 1 : 0.5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!ok)
                        .help(ok ? "Play" : "Not downloaded. Use Download to the server in Library.")
                    }
                }
            }
            .frame(maxHeight: 220)
        }
    }

    private func play(_ audible: [Track], from t: Track?) {
        guard !audible.isEmpty else { return }
        let start = t.flatMap { s in audible.firstIndex { $0.id == s.id } } ?? (player.shuffle ? Int.random(in: 0..<audible.count) : 0)
        player.play(audible, startAt: start)
    }

    private func showInLibrary() {
        guard let g = model.graph else { return }
        let have = Set(library.songs.flatMap { ($0.tags ?? []).map { $0.lowercased() } })
        ui.search = ""
        ui.filters = Set(g.filterTags(node.id).map { $0.lowercased() }.filter { have.contains($0) })
        nav.page = .library
    }
}
