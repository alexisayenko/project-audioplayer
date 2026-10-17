import SwiftUI

@MainActor
private enum GenreList {
    static var list: [String] = []
    static var songCount = -1
}

/// A chip field over one namespaced tag (`genre:`, `country:`), capped; genres suggest names from the server.
struct LibNamespaceField: View {
    let title: String
    let key: String
    let cap: Int
    @Binding var tags: [String]
    @Binding var input: String
    @State private var note: String?
    @State private var serverGenres: [String] = []
    @FocusState private var focused: Bool
    @EnvironmentObject private var settings: Settings
    @EnvironmentObject private var library: LibraryStore

    private var mine: [String] { tags.filter { tagKey($0) == key } }

    private func commit(final: Bool = true) {
        note = commitNamespaced(&tags, key: key, cap: cap, input: &input, final: final)
    }

    private var suggestions: [String] {
        guard key == "genre" else { return [] }
        let typed = input.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "," || $0 == "/" }).last.map(String.init) ?? ""
        let pool = serverGenres.isEmpty ? genresFromTags(library.songs.map { $0.tags ?? [] }) : serverGenres
        return suggestGenres(query: typed, genres: pool, chosen: mine.map(tagLabel))
    }

    private func pick(_ genre: String) {
        var parts = input.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "," || $0 == "/" }).map(String.init)
        if parts.isEmpty { parts = [genre] } else { parts[parts.count - 1] = genre }
        input = parts.joined(separator: ",")
        commit()
        focused = true
    }

    private func loadGenres() async {
        guard key == "genre" else { return }
        if GenreList.songCount == library.songs.count, !GenreList.list.isEmpty { serverGenres = GenreList.list; return }
        let list = (try? await APIClient(baseURL: settings.serverURL, token: settings.token).genres()) ?? []
        if !list.isEmpty { GenreList.list = list; GenreList.songCount = library.songs.count }
        serverGenres = list
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            if !mine.isEmpty {
                FlowLayout {
                    ForEach(mine, id: \.self) { t in LibChip(text: tagLabel(t), on: true, removable: true) { tags.removeAll { $0 == t } } }
                }
            }
            if mine.count < cap {
                TextField(key == "country" ? "Add a country" : "Add a genre", text: $input)
                    .focused($focused)
                    .onSubmit { commit() }
                    .onChange(of: input) { _, v in if v.contains(where: { $0 == "," || $0 == "/" }) { commit(final: false) } }
                    .onChange(of: focused) { _, f in if !f { commit() } }
                    .dsField()
                let hints = suggestions
                if !hints.isEmpty {
                    FlowLayout { ForEach(hints, id: \.self) { g in LibChip(text: g) { pick(g) } } }
                }
            }
            if let note { Text(note).dsCaption() }
        }
        .task(id: library.songs.count) { await loadGenres() }
        .onDisappear { commit() }
    }
}

/// Chosen tags, suggestions and the library's tags to pick from (web/js/tag-editor.js).
struct LibTagEditor: View {
    @Binding var tags: [String]
    @Binding var suggested: [String]
    let pool: [(tag: String, count: Int)]
    @Binding var input: String
    var hiddenKeys: Set<String> = ["lang"]
    @State private var showPool = false

    private func has(_ t: String) -> Bool { tags.contains { $0.lowercased() == t.lowercased() } }
    private func toggle(_ t: String) {
        if has(t) { tags.removeAll { $0.lowercased() == t.lowercased() } } else { tags.append(t) }
    }

    private func commit() {
        let r = splitTagInput(input)
        for t in r.tags where !has(t) && !hiddenKeys.contains(tagKey(t)) { tags.append(t) }
        input = r.rest
    }

    private var filtered: [TagGroup] {
        let q = input.trimmingCharacters(in: .whitespaces).lowercased()
        return tagGroups(pool.filter { !hiddenKeys.contains(tagKey($0.tag)) }
            .filter { q.isEmpty || $0.tag.lowercased().contains(q) || tagLabel($0.tag).lowercased().contains(q) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            TextField("Add a tag (plain or key:value)", text: $input)
                .onSubmit(commit)
                .onChange(of: input) { _, v in if v.contains(",") { commit() } }
                .dsField()
            let shown = tags.filter { !hiddenKeys.contains(tagKey($0)) }
            if !shown.isEmpty {
                FlowLayout { ForEach(shown, id: \.self) { t in LibChip(text: tagLabel(t), on: true, removable: true) { toggle(t) } } }
            }
            let open = suggested.filter { !has($0) && !hiddenKeys.contains(tagKey($0)) }
            if !open.isEmpty {
                Text("Suggested").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
                FlowLayout { ForEach(open, id: \.self) { t in LibChip(text: tagLabel(t)) { toggle(t) } } }
            }
            if !pool.isEmpty {
                Button { showPool.toggle() } label: {
                    Label(showPool || !input.isEmpty ? "Hide library tags" : "Library tags",
                          systemImage: showPool || !input.isEmpty ? "chevron.up" : "chevron.down")
                        .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                }
                .buttonStyle(.plain)
                if showPool || !input.isEmpty {
                    ForEach(filtered) { g in
                        Text(g.name).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
                        FlowLayout {
                            ForEach(g.tags, id: \.tag) { t in
                                LibChip(text: tagLabel(t.tag), count: t.count, on: has(t.tag)) { toggle(t.tag) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Article name or full link in, canonical Wikipedia link stored.
struct LibWikiField: View {
    let title: String
    @Binding var value: String
    @State private var text: String
    @FocusState private var focused: Bool

    init(title: String, value: Binding<String>) {
        self.title = title
        _value = value
        _text = State(initialValue: libWikiDisplay(value.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TextField(title, text: $text, prompt: Text("Article name or link"))
                .labelsHidden().focused($focused).dsField()
                .onSubmit(commit)
                .onChange(of: focused) { _, now in if !now { commit() } }
                .onChange(of: value) { _, _ in if !focused { text = libWikiDisplay(value) } }
        }
    }

    private func commit() {
        if text != libWikiDisplay(value) { value = libWikiNormalize(text) }
        text = libWikiDisplay(value)
    }
}
