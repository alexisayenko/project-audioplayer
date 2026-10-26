import SwiftUI

struct SongDetailsView: View {
    let id: String
    let play: (Track) -> Void
    let download: (Track) -> Void
    let notify: (String) -> Void
    let deleted: (Track) -> Void
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var player: PlayerService
    @EnvironmentObject private var server: ServerLink
    @EnvironmentObject private var anon: AnonDownloader
    @EnvironmentObject private var settings: Settings
    @EnvironmentObject private var listening: ListeningStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var editing: ServerSong?
    @State private var share = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var didDelete = false
    @State private var tick = 0
    private var track: Track? { library.songs.first { $0.id == id } }
    private var signedIn: Bool { ServerLink.hasCredentials(settings) }
    private var current: Bool { player.current?.id == id }
    private var transferring: Bool { server.transfers[id] != nil || anon.transfers[id] != nil }

    var body: some View {
        Group {
            if let track {
                ScrollView {
                    VStack(spacing: DS.Space.space4) {
                        CoverImage(source: track.thumbnail).frame(width: DS.Component.detailsCover, height: DS.Component.detailsCover)
                            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).dsShadow(DS.Shadow.depthSlab).accessibilityHidden(true)
                        VStack(spacing: DS.Space.space1) {
                            Text(track.title).font(T.title).foregroundStyle(DS.Color.ink).lineLimit(3)
                            Text(track.libraryArtist).font(T.body).foregroundStyle(DS.Color.inkMuted)
                            Text(versionLine(track)).font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                        }.multilineTextAlignment(.center)
                        primary(track)
                        facts(track)
                        if signedIn && listening.loaded { statistics }
                        actions(track)
                        Button { confirmDelete = true } label: {
                            Label("Delete from library", systemImage: "trash").font(T.body).foregroundStyle(DS.Color.powerText)
                                .frame(minHeight: DS.Component.rowHeight)
                        }.buttonStyle(LibraryPressStyle()).disabled(deleting).padding(.top, DS.Space.space8)
                    }
                    .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space4)
                }
                .safeAreaInset(edge: .top, spacing: 0) { header(track) }
                .confirmationDialog("Delete \"\(track.title)\" from the library?", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("Delete from library", role: .destructive) { Task { await delete(track) } }
                } message: {
                    Text(signedIn && track.localOnly != true ? "Removes the song from your library, on the server and on this iPhone." : "Removes the song and its audio from this iPhone.")
                }
                .sheet(isPresented: $share) {
                    ShareSheet(track: track, position: current ? player.position : 0, duration: track.duration ?? 0)
                }
            } else { Color.clear }
        }
        .dsGround().toolbar(.hidden, for: .navigationBar).background(LibraryBackSwipe())
        .sheet(item: $editing) { SongEditView(song: $0) }
        .sensoryFeedback(.success, trigger: tick)
        .onChange(of: library.songs) { _, _ in
            if track == nil && !deleting && !didDelete { dismiss(); notify("This song is no longer in your library") }
        }
    }

    private func header(_ track: Track) -> some View {
        ZStack {
            Text("Song Details").font(T.headline).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left").font(.system(size: DS.Icon.iconNav)).foregroundStyle(DS.Color.ink)
                        .frame(width: DS.Space.hit, height: DS.Space.hit)
                }.accessibilityLabel("Back")
                Spacer()
                if signedIn {
                    Button("Edit") { editing = ServerSong(track) }.font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit)
                }
            }
        }.padding(.horizontal, DS.Space.space4).background(DS.Color.ground)
    }
    private func versionLine(_ track: Track) -> String {
        [track.version?.name ?? track.version?.type?.capitalized ?? "", track.libraryYear.map(String.init) ?? ""]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }
    private func primary(_ track: Track) -> some View {
        let phone = library.contains(id)
        let transfer = server.transfers[id] ?? anon.transfers[id]
        let noAudio = !phone && track.onServer == false && transfer == nil
        let pausing = current && player.isPlaying
        let idleTitle: String
        let symbol: String
        if phone {
            idleTitle = pausing ? "Pause" : "Play"
            symbol = pausing ? "pause.fill" : "play.fill"
        } else {
            idleTitle = noAudio ? "No audio yet" : "Download to iPhone"
            symbol = "arrow.down.circle"
        }
        let title = transfer.map { "Downloading \(Int(min(1, max(0, $0.progress)) * 100))%" } ?? idleTitle
        return Button { if phone { play(track) } else { download(track) } } label: {
            Label(title, systemImage: symbol)
                .frame(minWidth: DS.Component.detailsCover)
        }
        .buttonStyle(LibraryPrimaryStyle()).disabled(noAudio || transfer != nil || (!phone && !signedIn))
    }
    private func facts(_ track: Track) -> some View {
        VStack(spacing: 0) {
            if let duration = track.duration, duration > 0 { fact("Duration", formatTime(duration)) }
            if let bpm = track.bpm { fact("BPM", "\(Int(bpm.rounded())) BPM") }
            if let year = track.libraryYear { fact("Release year", String(year)) }
            let genres = LibraryFacet.genres.keys(track).filter { $0 != LibraryFacet.genres.unknown }.sorted().map { LibraryFacet.genres.label($0) }
            if !genres.isEmpty { pills("Genres", genres) }
            let tags = LibraryFacet.tags.keys(track).sorted().map { LibraryFacet.tags.label($0) }
            if !tags.isEmpty { pills("Tags", tags) }
            let countries = LibraryFacet.countries.keys(track).filter { $0 != LibraryFacet.countries.unknown }.sorted().map { LibraryFacet.countries.label($0) }
            if !countries.isEmpty { fact("Country", countries.joined(separator: ", ")) }
            if library.contains(id) {
                fact("File name", track.fileURL.lastPathComponent).contextMenu {
                    Button("Copy file name") { UIPasteboard.general.string = track.fileURL.lastPathComponent; notify("File name copied") }
                }
            }
            if let url = source(track) {
                Button { openURL(url) } label: {
                    HStack { Text("Source").foregroundStyle(DS.Color.inkMuted); Spacer(); Text(url.host?.contains("soundcloud") == true ? "SoundCloud" : "YouTube"); Image(systemName: "chevron.right") }
                        .font(T.subhead).foregroundStyle(DS.Color.ink).frame(minHeight: DS.Component.rowHeight).contentShape(Rectangle())
                }.buttonStyle(LibraryPressStyle())
            }
        }.padding(.horizontal, DS.Space.space4).librarySlab()
    }
    private func fact(_ label: String, _ value: String) -> some View {
        VStack(spacing: 0) {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: DS.Space.space1) {
                    Text(label).foregroundStyle(DS.Color.inkMuted); Text(value).foregroundStyle(DS.Color.ink)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, DS.Space.space2)
            } else {
                HStack(spacing: DS.Space.space3) {
                    Text(label).foregroundStyle(DS.Color.inkMuted).fixedSize()
                    Spacer(minLength: 0)
                    Text(value).foregroundStyle(DS.Color.ink).multilineTextAlignment(.trailing)
                        .lineLimit(label == "File name" ? 1 : nil).truncationMode(.middle)
                }.frame(minHeight: DS.Component.rowHeight)
            }
            LibraryHairline()
        }.font(T.subhead).accessibilityElement(children: .combine)
    }
    private func pills(_ title: String, _ values: [String]) -> some View {
        VStack(spacing: 0) {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: DS.Space.space2) {
                    Text(title).font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                    pillFlow(values)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, DS.Space.space2)
            } else {
                HStack(spacing: DS.Space.space3) {
                    Text(title).font(T.subhead).foregroundStyle(DS.Color.inkMuted).fixedSize()
                    Spacer(minLength: 0)
                    pillFlow(values)
                }.frame(minHeight: DS.Component.rowHeight)
            }
            LibraryHairline()
        }
    }
    private func pillFlow(_ values: [String]) -> some View {
        FlowLayout {
            ForEach(values, id: \.self) { value in
                Text(value).font(T.subhead.weight(.medium)).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, DS.Space.space3).frame(minHeight: DS.Component.iconButton)
                    .background(Capsule().fill(DS.Color.accentTint))
            }
        }
    }
    private var statistics: some View {
        let entry = listening.entries[id]
        let date = entry?.lastListened.flatMap { ISO8601DateFormatter().date(from: $0 + "T00:00:00Z") }
        return VStack(alignment: .leading, spacing: DS.Space.space2) {
            SectionLabel("Playback statistics")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: DS.Space.space3) { statisticCells(entry, date: date) }
                VStack(spacing: DS.Space.space3) { statisticCells(entry, date: date) }
            }.padding(DS.Space.space4).frame(maxWidth: .infinity).librarySlab()
        }
    }
    @ViewBuilder private func statisticCells(_ entry: LibraryListeningEntry?, date: Date?) -> some View {
        stat("Plays", String(entry?.listened?.all ?? 0))
        stat("Last played", date.map { $0.formatted(.relative(presentation: .named)) } ?? "Never", voice: date?.formatted(date: .complete, time: .omitted))
        let minutes = Int(max(0, entry?.totalListenedS ?? 0)) / 60
        stat("Total listened", minutes >= 60 ? "\(minutes / 60) h \(minutes % 60) min" : "\(minutes) min")
    }
    private func stat(_ label: String, _ value: String, voice: String? = nil) -> some View {
        VStack(spacing: DS.Space.space1) {
            Text(value).font(T.title).foregroundStyle(DS.Color.ink)
            Text(label).font(T.caption).foregroundStyle(DS.Color.inkMuted)
        }.frame(maxWidth: .infinity).accessibilityElement(children: .ignore).accessibilityLabel("\(label), \(voice ?? value)")
    }
    private func actions(_ track: Track) -> some View {
        VStack(spacing: 0) {
            if library.contains(id) && !current {
                action("Play next", "text.insert") { player.playNext(track); tick += 1; notify("Plays next") }
                action("Add to queue", "text.badge.plus") {
                    let added = player.enqueue([track]) > 0
                    if added { tick += 1 }; notify(added ? "Added to queue" : "Already in queue")
                }
            }
            action("Share link", "square.and.arrow.up") { share = true }
            if !library.contains(id) && track.onServer != false && !transferring && signedIn {
                action("Download", "arrow.down.circle") { download(track) }
            } else if library.contains(id) && track.localOnly != true && !current && signedIn {
                action("Remove from iPhone", "iphone.slash") { library.removeAudio(id); notify("Removed from this iPhone") }
            }
        }.padding(.horizontal, DS.Space.space4).librarySlab()
    }
    private func action(_ title: String, _ icon: String, perform: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            Button(action: perform) {
                Label(title, systemImage: icon).font(T.body).foregroundStyle(DS.Color.ink)
                    .frame(maxWidth: .infinity, minHeight: DS.Component.rowHeight, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(LibraryPressStyle())
            LibraryHairline()
        }
    }
    private func source(_ track: Track) -> URL? {
        ([track.sourceURL] + (track.sources ?? []).map(\.url)).compactMap { $0 }.compactMap(URL.init(string:))
            .first { ["https", "http"].contains($0.scheme?.lowercased() ?? "") }
    }
    private func delete(_ track: Track) async {
        guard !deleting else { return }
        deleting = true
        defer { deleting = false }
        if signedIn && track.localOnly != true {
            do { try await APIClient(baseURL: settings.serverURL, token: settings.token).delete(id) }
            catch APIError.http(404, _) { /* Already removed remotely; finish local deletion. */ }
            catch { notify("Couldn't delete. Check the server and try again."); return }
        }
        let offsets = IndexSet(player.queue.indices.filter { player.queue[$0].id == id })
        let continuePlayback = current && player.isPlaying
        if !offsets.isEmpty { player.removeFromQueue(at: offsets) }
        didDelete = true
        library.delete(id)
        if continuePlayback && player.current != nil { player.resume() }
        deleted(track)
    }
}

/// Retain the native edge-swipe gesture with the artboard's custom navigation bar.
struct LibraryBackSwipe: UIViewControllerRepresentable {
    func makeUIViewController(context _: Context) -> Controller { Controller() }
    func updateUIViewController(_: Controller, context _: Context) {
        // The controller holds all the state it needs.
    }

    final class Controller: UIViewController {
        private weak var previousDelegate: UIGestureRecognizerDelegate?
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let navigationController, navigationController.viewControllers.count > 1,
                  let gesture = navigationController.interactivePopGestureRecognizer else { return }
            previousDelegate = gesture.delegate
            gesture.delegate = nil
            gesture.isEnabled = true
        }
        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            navigationController?.interactivePopGestureRecognizer?.delegate = previousDelegate
        }
    }
}
