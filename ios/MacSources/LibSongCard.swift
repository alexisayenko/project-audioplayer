import SwiftUI

/// Read-only card over Library: cover, facts, tags, links and the song's actions. Closes itself if the song is deleted.
struct LibSongCard: View {
    let trackID: String
    let callbacks: LibRowCallbacks
    let close: () -> Void
    let edit: (Track) -> Void
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var player: PlayerService
    @ObservedObject private var ui = LibraryUIState.shared

    private var track: Track? { library.songs.first { $0.id == trackID } }

    var body: some View {
        Group {
            if let t = track { content(t) } else { Color.clear.frame(width: 560, height: 200).onAppear(perform: close) }
        }
        .background(DS.Color.surface)
    }

    private func hasAudio(_ t: Track) -> Bool { library.contains(t.id) || (t.onServer ?? true) }

    private func status(_ t: Track) -> String {
        if let f = ui.fetches[t.id] {
            switch f.phase {
            case .queued: return "Queued for download"
            case .running: return "Downloading \(Int((f.progress * 100).rounded()))%"
            case .converting: return "Converting"
            case .failed: return "Download failed"
            }
        }
        return hasAudio(t) ? "Downloaded to the server" : "Not downloaded"
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(T.caption).foregroundStyle(DS.Color.inkMuted).frame(width: 64, alignment: .leading)
            Text(value).font(T.subhead).foregroundStyle(DS.Color.ink)
            Spacer(minLength: 0)
        }
    }

    private func content(_ t: Track) -> some View {
        let tags = (t.tags ?? []).filter { tagKey($0) != "lang" }
        let inQueue = player.queue.contains { $0.id == t.id }
        return VStack(alignment: .leading, spacing: DS.Space.space4) {
            HStack {
                Spacer()
                Button("Close", action: close).buttonStyle(.plain).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                    .keyboardShortcut(.cancelAction)
            }
            HStack(alignment: .top, spacing: DS.Space.space5) {
                LibCover(source: t.thumbnail, radius: DS.Radius.radiusCard)
                    .frame(width: 240, height: 240)
                    .overlay(alignment: .bottomLeading) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(SongName.titleLine(t)).font(DS.Font.headline).lineLimit(2)
                            Text(SongName.subtitle(t)).font(T.caption).lineLimit(1)
                        }
                        .foregroundStyle(DS.Color.ink)
                        .padding(DS.Space.space3).frame(maxWidth: .infinity, alignment: .leading)
                        .background(LinearGradient(colors: [.clear, DS.Color.surface.opacity(0.92)], startPoint: .top, endPoint: .bottom))
                        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous))
                    }
                VStack(alignment: .leading, spacing: DS.Space.space2) {
                    if let c = tags.first(where: { tagKey($0) == "country" }) { fact("Country", tagLabel(c)) }
                    if let b = t.bpm { fact("BPM", "\(Int(b.rounded()))") }
                    if let d = t.duration { fact("Time", macTime(d)) }
                    fact("Status", status(t))
                    if let a = t.album, !a.isEmpty { fact("Album", a) }
                    if let r = t.remixer, !r.isEmpty { fact("Remix", r) }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            if !tags.isEmpty {
                FlowLayout { ForEach(tags, id: \.self) { LibTagPill(text: tagLabel($0)) } }
            }
            links(t)
            HStack(spacing: DS.Space.space2) {
                if hasAudio(t) {
                    Button { callbacks.playNow(t) } label: { Label("Play now", systemImage: "play.fill") }.buttonStyle(LibLitButtonStyle())
                }
                Spacer(minLength: 0)
                if !hasAudio(t), ui.fetches[t.id] == nil {
                    Button { callbacks.fetch(t) } label: { Image(systemName: "arrow.down.circle") }
                        .buttonStyle(LibRoundButtonStyle()).help("Download to the server")
                }
                Button { callbacks.toggleQueue(t) } label: { Image(systemName: inQueue ? "checkmark" : "plus") }
                    .buttonStyle(LibRoundButtonStyle(on: inQueue)).help(inQueue ? "In playlist - click to remove" : "Add to playlist")
                Button { edit(t) } label: { Image(systemName: "pencil") }
                    .buttonStyle(LibRoundButtonStyle()).help("Edit song")
            }
        }
        .padding(DS.Space.space5)
        .frame(width: 560)
    }

    private func links(_ t: Track) -> some View {
        let src = LibLinks.source(t)
        let wiki = LibLinks.url(t.wikipediaSong) ?? LibLinks.url(t.wikipediaArtist)
        let mb = LibLinks.url(t.musicbrainzURL)
        return HStack(spacing: DS.Space.space1) {
            if let src { ServiceIcon(kind: src.kind, active: true, url: src.url) }
            if let wiki { ServiceIcon(kind: .wikipedia, active: true, url: wiki) }
            if let mb { ServiceIcon(kind: .musicbrainz, active: true, url: mb) }
        }
    }
}
