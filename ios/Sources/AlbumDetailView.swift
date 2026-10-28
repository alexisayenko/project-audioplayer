import SwiftUI

/// One album as a song list (IOS-099): tracks in order, missing tracks muted, status, play, queue, shuffle and Download album.
struct AlbumDetailView: View {
    let id: String
    @EnvironmentObject private var store: AlbumStore
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var server: ServerLink
    @EnvironmentObject private var settings: Settings
    @EnvironmentObject private var downloader: AlbumDownloader
    @State private var planning = false
    @State private var retrying = false
    @State private var toast: String?

    private var album: Album? { store.album(id) }
    private var byID: [String: Track] { Dictionary(library.songs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }) }

    var body: some View {
        let songs = byID
        SongListScreen(title: album?.title ?? "Album", lines: lines(songs), coverSource: album.flatMap { AlbumCover.source($0, thumbnails: songs.mapValues(\.thumbnail)) },
                       entries: entries(songs), emptyText: "This album has no tracks.", transfer: { downloader.rowState($0, in: id) },
                       showsMenu: false, extra: { downloadControls(songs) }, menu: { EmptyView() })
            .listToast($toast)
            .task { await store.refresh(settings) }
            .sheet(isPresented: $planning) {
                if let album {
                    AlbumDownloadSheet(album: album, songs: songs) { plan in
                        planning = false
                        downloader.start(album: album, plan: plan, settings: settings, library: library, server: server)
                    }
                }
            }
    }

    private func entries(_ songs: [String: Track]) -> [SongListEntry] {
        (album?.tracks ?? []).map { track in
            if let songID = track.songId, let song = songs[songID] { return .song(song) }
            return .missing(number: track.no, title: track.title, duration: track.durationS)
        }
    }

    private func lines(_ songs: [String: Track]) -> [String] {
        guard let album else { return [] }
        let ids = Set(songs.keys)
        return [AlbumLogic.byline(album), AlbumLogic.summary(album),
                AlbumLogic.statusText(album, libraryIDs: ids, ready: server.libraryReady(signedIn: ServerLink.hasCredentials(settings), hasSongs: !songs.isEmpty)) + " · " + AlbumLogic.phoneText(album, phoneIDs: library.phoneIDs)].filter { !$0.isEmpty }
    }

    private func pending(_ songs: [String: Track]) -> Int {
        (album?.tracks ?? []).compactMap(\.songId).filter { songs[$0] != nil && !library.contains($0) }.count
    }

    private func retryServer() {
        retrying = true
        Task {
            await store.refresh(settings)
            retrying = false
        }
    }

    @ViewBuilder private func downloadControls(_ songs: [String: Track]) -> some View {
        if let run = downloader.run(for: id) {
            AlbumRunCard(run: run, cancel: { downloader.cancel(id) }, dismiss: { downloader.dismissResult(id) })
        } else {
            let count = pending(songs)
            if count > 0 && server.reachable == false { OfflineDownloadNote(retrying: retrying) { retryServer() } }
            Button { planning = true } label: {
                Label(count > 0 ? "Download album (\(count))" : "All linked tracks are on this iPhone", systemImage: "arrow.down.circle")
            }
            .buttonStyle(DSButtonStyle(kind: .outline)).disabled(count == 0 || server.reachable == false)
        }
    }
}

/// Progress, the hourly pause, cancel and the result line of one album download (IOS-100).
struct AlbumRunCard: View {
    let run: AlbumRun
    let cancel: () -> Void
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            if run.running {
                TimelineView(.periodic(from: .now, by: 15)) { context in
                    VStack(alignment: .leading, spacing: DS.Space.space2) {
                        Text("Downloading \(run.progressText)").font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
                        ProgressView(value: Double(run.processed), total: Double(max(run.total, 1))).tint(DS.Color.accent)
                        if let pause = run.pauseText(now: context.date) { Text(pause).font(T.caption).foregroundStyle(DS.Color.accentInk) }
                    }
                }
                Button("Cancel", action: cancel).buttonStyle(DSButtonStyle(kind: .quiet))
            } else {
                Text(run.summary).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
                if run.failed > 0 { Text("Tap Download album again to retry the failed tracks.").font(T.caption).foregroundStyle(DS.Color.inkMuted) }
                Button("Done", action: dismiss).buttonStyle(DSButtonStyle(kind: .quiet))
            }
        }
        .padding(DS.Space.space4).frame(maxWidth: .infinity, alignment: .leading).librarySlab()
        .accessibilityElement(children: .contain)
    }
}

/// The plan before the first transfer (IOS-100): what will be fetched and copied, the size, the fetches left this hour.
struct AlbumDownloadSheet: View {
    let album: Album
    let songs: [String: Track]
    let start: (AlbumDownloadPlan) -> Void
    @EnvironmentObject private var store: AlbumStore
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var settings: Settings
    @Environment(\.dismiss) private var dismiss
    @State private var usage: ServerUsage?
    @State private var loading = true

    private var plan: AlbumDownloadPlan {
        let bps = AlbumDownloadPlan.bytesPerSecond(songs: Array(songs.values), usage: usage)
        return AlbumDownloadPlan.make(tracks: album.tracks, songs: songs, phoneIDs: library.phoneIDs, usage: usage, bytesPerSecond: bps)
    }

    var body: some View {
        let plan = plan
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            Text("Download album").font(T.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
            Text(album.title).font(T.headline).foregroundStyle(DS.Color.inkMuted).lineLimit(2)
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                Text(plan.costLine).font(T.body).foregroundStyle(DS.Color.ink)
                if let line = plan.linkedLine { Text(line).font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
                if loading { Text("Checking your limits…").font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
                else if let quota = plan.quotaLine { Text(quota).font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
                else if usage == nil { Text("Couldn't read your limits. The server stops the download if one is reached.").font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
                if let wait = plan.waitLine { Text(wait).font(T.subhead).foregroundStyle(DS.Color.accentInk) }
                if let blocked = plan.blocked { Text(blocked).font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.powerText) }
                if plan.pending == 0 { Text("Every linked track is already on this iPhone.").font(T.subhead).foregroundStyle(DS.Color.inkMuted) }
            }
            .padding(DS.Space.space4).frame(maxWidth: .infinity, alignment: .leading).librarySlab()
            HStack(spacing: DS.Space.space2) {
                Button("Cancel") { dismiss() }.buttonStyle(DSButtonStyle(kind: .outline))
                Button("Download") { start(plan) }.buttonStyle(LibraryPrimaryStyle()).disabled(!plan.runnable || loading)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space6)
        .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        .presentationCornerRadius(DS.Radius.radiusTray).presentationBackground(DS.Color.ground)
        .task {
            usage = await store.loadUsage(settings)
            loading = false
        }
    }
}
