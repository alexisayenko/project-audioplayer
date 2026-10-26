import SwiftUI

struct PlaylistRoute: Hashable {
    let id: String
}

/// The Playlists destination (PLS-121): the user's saved playlists; each opens to a song list.
struct PlaylistsView: View {
    @EnvironmentObject private var store: PlaylistStore
    @EnvironmentObject private var library: LibraryStore
    @EnvironmentObject private var settings: Settings
    @ObservedObject private var auth = AuthService.shared
    @Environment(\.openSettings) private var openSettings
    @State private var path: [PlaylistRoute] = []
    @State private var creating = false
    @State private var newName = ""
    @State private var renaming: PlaylistSummary?
    @State private var renameText = ""
    @State private var deleting: PlaylistSummary?
    @State private var toast: String?

    private var signedIn: Bool { ServerLink.hasCredentials(settings) }
    private var accountKey: String { signedIn ? CollectionCache.accountKey(settings) : "" }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: DS.Space.space3) { content }
                    .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space3).padding(.bottom, DS.Space.space4)
            }
            .refreshable { await store.refresh(settings) }
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .dsGround().toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: PlaylistRoute.self) { PlaylistDetailView(id: $0.id) }
        }
        .listToast($toast)
        .task(id: accountKey) {
            store.adopt(settings, signedIn: signedIn)
            if signedIn { await store.refresh(settings) } else { path = [] }
        }
        .alert("New playlist", isPresented: $creating) {
            TextField("Name", text: $newName)
            Button("Create") { create() }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Rename playlist", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Rename") { rename() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete \"\(deleting?.name ?? "")\"?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("Delete playlist", role: .destructive) { delete() }
        } message: { Text("The songs stay in your library.") }
    }

    private var header: some View {
        ScreenHeader(title: "Playlists") {
            if signedIn {
                Button { newName = ""; creating = true } label: {
                    Image(systemName: "plus").font(.system(size: DS.Icon.iconNavLg, weight: DS.Icon.iconWeightStrong))
                        .foregroundStyle(DS.Color.onAccent).frame(width: DS.Space.hit, height: DS.Space.hit)
                        .background(Circle().fill(DS.Color.accent).dsShadow(DS.Shadow.depthGlowSoft))
                }.buttonStyle(LibraryPressStyle()).accessibilityLabel("New playlist")
            }
        }.padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).background(DS.Color.ground)
    }

    @ViewBuilder private var content: some View {
        if !signedIn {
            LibraryEmpty(title: "Playlists need an account", symbol: "music.note.list",
                         detail: "Sign in to keep playlists. Songs on this iPhone still play without an account.") {
                Button("Sign in") { openSettings?() }.buttonStyle(LibraryPrimaryStyle())
            }
        } else if !store.loaded && store.failure == nil {
            LibrarySkeleton()
        } else if !store.loaded {
            LibraryEmpty(title: "Can't load playlists", symbol: "wifi.slash", detail: store.failure ?? "Check the connection and try again.") {
                Button("Retry") { Task { await store.refresh(settings) } }.buttonStyle(LibraryPrimaryStyle())
            }
        } else if store.lists.isEmpty {
            LibraryEmpty(title: "No playlists yet", symbol: "music.note.list", detail: "A playlist is a named, ordered list of songs from your library.") {
                Button("New playlist") { newName = ""; creating = true }.buttonStyle(LibraryPrimaryStyle())
            }
        } else {
            if store.failure != nil { offlineNote }
            lists
        }
    }

    private var offlineNote: some View {
        HStack(spacing: DS.Space.space2) {
            Image(systemName: "wifi.slash").font(.system(size: DS.Icon.iconInline)).foregroundStyle(DS.Color.inkMuted)
            Text("Offline. Showing the last playlists. Downloaded songs still play.").font(T.caption).foregroundStyle(DS.Color.ink)
            Spacer(minLength: 0)
        }.padding(DS.Space.space3).librarySlab(radius: DS.Radius.radiusKey)
    }

    private var lists: some View {
        let thumbs = Dictionary(library.songs.map { ($0.id, $0.thumbnail) }, uniquingKeysWith: { first, _ in first })
        return LazyVStack(spacing: 0) {
            ForEach(Array(store.lists.enumerated()), id: \.element.id) { index, list in
                PlaylistRow(list: list, cover: list.firstSongID.flatMap { thumbs[$0] ?? nil }) { path.append(PlaylistRoute(id: list.id)) }
                    .contextMenu {
                        Button { renameText = list.name; renaming = list } label: { Label("Rename", systemImage: "pencil") }
                        Button(role: .destructive) { deleting = list } label: { Label("Delete", systemImage: "trash") }
                    }
                if index < store.lists.count - 1 { LibraryHairline().padding(.horizontal, DS.Space.space3) }
            }
        }.clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusCard)).librarySlab()
    }

    private func create() {
        guard let name = PlaylistLogic.cleanName(newName) else { toast = "A playlist name needs 1 to \(PlaylistLogic.nameMax) characters"; return }
        Task {
            do {
                let made = try await store.create(name: name, settings)
                path.append(PlaylistRoute(id: made.id))
            } catch { toast = error.localizedDescription }
        }
    }

    private func rename() {
        guard let list = renaming else { return }
        guard let name = PlaylistLogic.cleanName(renameText) else { toast = "A playlist name needs 1 to \(PlaylistLogic.nameMax) characters"; return }
        Task {
            do { try await store.rename(list.id, to: name, settings) } catch { toast = error.localizedDescription }
        }
    }

    private func delete() {
        guard let list = deleting else { return }
        Task {
            do { try await store.delete(list.id, settings); toast = "Deleted \"\(list.name)\"" } catch { toast = error.localizedDescription }
        }
    }
}

struct PlaylistRow: View {
    let list: PlaylistSummary
    let cover: String?
    let open: () -> Void
    @ScaledMetric(relativeTo: .body) private var scaledCover = DS.Component.coverRow
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Button(action: open) {
            HStack(spacing: DS.Space.space3) {
                CoverImage(source: cover).frame(width: min(scaledCover, DS.Component.coverRow * 1.5), height: min(scaledCover, DS.Component.coverRow * 1.5))
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.radiusSm)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: DS.Space.space1) {
                    Text(list.name).font(T.headline).foregroundStyle(DS.Color.ink).lineLimit(typeSize.isAccessibilitySize ? 3 : 2)
                    Text(PlaylistLogic.songCount(list.count)).font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: DS.Icon.iconInline)).foregroundStyle(DS.Color.inkFaint).accessibilityHidden(true)
            }
            .padding(DS.Space.space3).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(LibraryPressStyle()).background(DS.Color.surface)
        .accessibilityLabel("\(list.name), \(PlaylistLogic.songCount(list.count))")
    }
}
