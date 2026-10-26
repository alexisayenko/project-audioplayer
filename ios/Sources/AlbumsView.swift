import SwiftUI

enum LibraryMode: String, CaseIterable, Identifiable {
    case songs = "Songs", albums = "Albums"
    var id: String { rawValue }
    var symbol: String { self == .songs ? "music.note" : "square.stack" }
}

/// "Songs | Albums" under the Library header (IOS-098); shown to signed-in users only.
struct LibraryModeSwitch: View {
    @Binding var mode: LibraryMode

    var body: some View {
        HStack(spacing: DS.Space.space2) {
            ForEach(LibraryMode.allCases) { item in
                LibraryFilterChip(title: item.rawValue, symbol: item.symbol, selected: mode == item,
                                  hint: "Shows \(item.rawValue.lowercased())") { mode = item }
            }
            Spacer(minLength: 0)
        }
    }
}

/// Keeps the Songs list and the Albums view alive side by side, so each keeps its search, filters and scroll.
struct LibraryHome: View {
    @EnvironmentObject private var settings: Settings
    @ObservedObject private var auth = AuthService.shared
    @State private var mode = LibraryMode.songs

    private var signedIn: Bool { ServerLink.hasCredentials(settings) }

    var body: some View {
        ZStack {
            LibraryView(mode: $mode)
                .opacity(mode == .songs ? 1 : 0).allowsHitTesting(mode == .songs)
                .accessibilityHidden(mode != .songs).zIndex(mode == .songs ? 1 : 0)
            if signedIn {
                AlbumsView(mode: $mode)
                    .opacity(mode == .albums ? 1 : 0).allowsHitTesting(mode == .albums)
                    .accessibilityHidden(mode != .albums).zIndex(mode == .albums ? 1 : 0)
            }
        }
        .onChange(of: signedIn) { _, value in if !value { mode = .songs } }
    }
}

struct AlbumRoute: Hashable {
    let id: String
}

/// The Albums mode of the Library (IOS-098): a grid of covers with status, search, sort and an "On phone" filter.
struct AlbumsView: View {
    @Binding var mode: LibraryMode
    @EnvironmentObject private var store: AlbumStore
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var settings: Settings
    @Environment(\.dynamicTypeSize) private var typeSize
    @AppStorage("albums.sort") private var sortRaw = AlbumSort.added.rawValue
    @AppStorage("albums.reversed") private var reversed = false
    @State private var path: [AlbumRoute] = []
    @State private var search = ""
    @State private var onPhoneOnly = false

    private var signedIn: Bool { ServerLink.hasCredentials(settings) }
    private var accountKey: String { signedIn ? CollectionCache.accountKey(settings) : "" }
    private var sort: AlbumSort { AlbumSort(rawValue: sortRaw) ?? .added }

    private var shown: [Album] {
        let ids = Set(library.songs.map(\.id))
        let found = store.albums.filter { AlbumLogic.matches($0, query: search) }
            .filter { !onPhoneOnly || AlbumLogic.allLinkedOnPhone($0, libraryIDs: ids, phoneIDs: library.phoneIDs) }
        return AlbumLogic.sorted(found, by: sort, reversed: reversed)
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                content.padding(.horizontal, DS.Space.space4).padding(.bottom, DS.Space.space4)
            }
            .refreshable { await store.refresh(settings) }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .top, spacing: 0) { pinned }
            .dsGround().toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AlbumRoute.self) { AlbumDetailView(id: $0.id) }
        }
        .task(id: accountKey) {
            store.adopt(settings, signedIn: signedIn)
            if signedIn { await store.refresh(settings) } else { path = [] }
        }
    }

    private var pinned: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: "Library").padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2)
            LibraryModeSwitch(mode: $mode).padding(.horizontal, DS.Space.space4)
            if !store.albums.isEmpty {
                LibrarySearchField(text: $search, placeholder: "Search albums, artists, tracks").padding(.horizontal, DS.Space.space4)
                controls.padding(.horizontal, DS.Space.space4)
            }
        }.background(DS.Color.ground)
    }

    private var controls: some View {
        HStack(spacing: DS.Space.space2) {
            Menu {
                Picker("Sort by", selection: $sortRaw) {
                    ForEach(AlbumSort.allCases) { Text($0.rawValue).tag($0.rawValue) }
                }
                Toggle("Reverse order", isOn: $reversed)
            } label: {
                Label(sort.rawValue, systemImage: "arrow.up.arrow.down").font(T.subhead.weight(.medium)).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, DS.Space.space3).frame(minHeight: DS.Control.control)
                    .background(Capsule().fill(DS.Color.surface).dsShadow(DS.Shadow.depthSlab))
                    .frame(minHeight: DS.Space.hit).contentShape(Rectangle())
            }.accessibilityLabel("Sort by, \(sort.rawValue)")
            LibraryFilterChip(title: "On phone", symbol: "iphone", selected: onPhoneOnly, hint: "Shows only albums with every linked track on this iPhone") {
                onPhoneOnly.toggle()
            }
            Spacer(minLength: 0)
            Text("\(shown.count) of \(store.albums.count)").font(T.caption).monospacedDigit().foregroundStyle(DS.Color.inkMuted)
        }
    }

    @ViewBuilder private var content: some View {
        if !store.loaded && store.failure == nil {
            LibrarySkeleton()
        } else if !store.loaded {
            LibraryEmpty(title: "Can't load albums", symbol: "wifi.slash", detail: store.failure ?? "Check the connection and try again.") {
                Button("Retry") { Task { await store.refresh(settings) } }.buttonStyle(LibraryPrimaryStyle())
            }
        } else if store.albums.isEmpty {
            LibraryEmpty(title: "No albums yet", symbol: "square.stack", detail: "Add an album on the web (Library, Albums, Add album). It appears here, ready to play and download.") { EmptyView() }
        } else if shown.isEmpty {
            LibraryEmpty(title: "No albums found", symbol: "magnifyingglass", detail: "Try a different search or clear the filter.") { EmptyView() }
        } else {
            VStack(spacing: DS.Space.space3) {
                if store.failure != nil { offlineNote }
                grid
            }
        }
    }

    private var offlineNote: some View {
        HStack(spacing: DS.Space.space2) {
            Image(systemName: "wifi.slash").font(.system(size: DS.Icon.iconInline)).foregroundStyle(DS.Color.inkMuted)
            Text("Offline. Showing the last albums. Downloaded songs still play.").font(T.caption).foregroundStyle(DS.Color.ink)
            Spacer(minLength: 0)
        }.padding(DS.Space.space3).librarySlab(radius: DS.Radius.radiusKey)
    }

    private var grid: some View {
        let ids = Set(library.songs.map(\.id))
        let thumbs = Dictionary(library.songs.map { ($0.id, $0.thumbnail) }, uniquingKeysWith: { first, _ in first })
        let columns = typeSize.isAccessibilitySize ? [GridItem(.flexible())] : [GridItem(.flexible(), spacing: DS.Space.space3), GridItem(.flexible())]
        return LazyVGrid(columns: columns, spacing: DS.Space.space4) {
            ForEach(shown) { album in
                AlbumCard(album: album, cover: AlbumCover.source(album, thumbnails: thumbs), libraryIDs: ids, phoneIDs: library.phoneIDs) {
                    path.append(AlbumRoute(id: album.id))
                }
            }
        }
    }
}

enum AlbumCover {
    /// The album's own cover, else the cover of its first linked song.
    static func source(_ album: Album, thumbnails: [String: String?]) -> String? {
        if let own = album.coverUrl, !own.isEmpty { return own }
        return album.tracks.compactMap(\.songId).compactMap { thumbnails[$0] ?? nil }.first
    }
}

struct AlbumCard: View {
    let album: Album
    let cover: String?
    let libraryIDs: Set<String>
    let phoneIDs: Set<String>
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                Color.clear.aspectRatio(1, contentMode: .fit)
                    .overlay { CoverImage(source: cover) }
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).dsShadow(DS.Shadow.depthSlab)
                    .accessibilityHidden(true)
                Text(album.title).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(2).multilineTextAlignment(.leading)
                let byline = AlbumLogic.byline(album)
                if !byline.isEmpty { Text(byline).font(T.subhead).foregroundStyle(DS.Color.inkMuted).lineLimit(1) }
                Text(AlbumLogic.statusText(album, libraryIDs: libraryIDs)).font(T.caption.weight(.semibold))
                    .foregroundStyle(AlbumLogic.isComplete(album, libraryIDs: libraryIDs) ? DS.Color.accentInk : DS.Color.inkMuted)
                Text(AlbumLogic.phoneText(album, phoneIDs: phoneIDs)).font(T.caption).foregroundStyle(DS.Color.inkMuted)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading).contentShape(Rectangle())
        }
        .buttonStyle(LibraryPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([album.title, AlbumLogic.byline(album), AlbumLogic.statusText(album, libraryIDs: libraryIDs),
                             AlbumLogic.phoneText(album, phoneIDs: phoneIDs)].filter { !$0.isEmpty }.joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
    }
}
