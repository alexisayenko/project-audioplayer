import SwiftUI

/// Tag on a song (Add sheet, song sheet): accent-tint pill, ink label, optional remove glyph.
struct TagPill: View {
    let text: String
    var removable = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(text).lineLimit(1)
                if removable { Image(systemName: "xmark").dsIcon(11, weight: .bold).foregroundStyle(DS.Color.accentInk) }
            }
            .font(T.subhead.weight(.medium)).foregroundStyle(DS.Color.ink)
            .padding(.horizontal, DS.Space.space3).frame(minHeight: 32)
            .background(Capsule().fill(DS.Color.accentTint))
            .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(text)")
    }
}

/// The outlined round "+" that opens the tag editor.
struct AddTagButton: View {
    var open: Bool
    let action: () -> Void
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Button(action: action) {
            Image(systemName: open ? "chevron.up" : "plus").dsIcon(14, weight: .semibold)
                .foregroundStyle(DS.Color.accentInk)
                .frame(width: 32, height: 32).overlay(Circle().stroke(contrast.outline, lineWidth: 1.5))
                .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(open ? "Hide tag editor" : "Add tag")
    }
}

/// Port of web/js/tag-editor.js: chosen tags, suggestions, and the library's tags to pick from.
struct TagEditor: View {
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
        return tagGroups(pool.filter { !hiddenKeys.contains(tagKey($0.tag)) }.filter { q.isEmpty || $0.tag.lowercased().contains(q) || tagLabel($0.tag).lowercased().contains(q) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            TextField("Add a tag (plain or key:value)", text: $input, prompt: dsPrompt("Add a tag (plain or key:value)"))
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(commit)
                .onChange(of: input) { _, v in if v.contains(",") { commit() } }
                .dsField()
            let shown = tags.filter { !hiddenKeys.contains(tagKey($0)) }
            if !shown.isEmpty {
                FlowLayout {
                    ForEach(shown, id: \.self) { t in TagChip(text: tagLabel(t), on: true, removable: true) { toggle(t) } }
                }
            }
            let open = suggested.filter { !has($0) && !hiddenKeys.contains(tagKey($0)) }
            if !open.isEmpty {
                SectionLabel("Suggested")
                FlowLayout { ForEach(open, id: \.self) { t in TagChip(text: tagLabel(t)) { toggle(t) } } }
            }
            if !pool.isEmpty {
                Button { showPool.toggle() } label: {
                    Label(showPool || !input.isEmpty ? "Hide library tags" : "Library tags",
                          systemImage: showPool || !input.isEmpty ? "chevron.up" : "chevron.down")
                        .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .frame(minHeight: DS.Space.hit)
                }
                .buttonStyle(.plain)
                if showPool || !input.isEmpty {
                    ForEach(filtered) { g in
                        SectionLabel(g.name)
                        FlowLayout {
                            ForEach(g.tags, id: \.tag) { t in
                                TagChip(text: tagLabel(t.tag), count: t.count, on: has(t.tag)) { toggle(t.tag) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// A chip field that is a view over one namespaced tag (`genre:`, `country:`), capped.
struct NamespaceField: View {
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
    private var placeholder: String { key == "country" ? "Add a country" : "Add a genre" }

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
        if let cached = GenreCache.value(for: library.songs.count) { serverGenres = cached; return }
        let list = (try? await APIClient(baseURL: settings.serverURL, token: settings.token).genres()) ?? []
        GenreCache.store(list, for: library.songs.count)
        serverGenres = list
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            if !mine.isEmpty {
                FlowLayout {
                    ForEach(mine, id: \.self) { t in
                        TagChip(text: tagLabel(t), on: true, removable: true) { tags.removeAll { $0 == t } }
                    }
                }
                .padding(.vertical, DS.Space.space1)
            }
            if mine.count < cap {
                TextField(placeholder, text: $input, prompt: dsPrompt(placeholder))
                    .textInputAutocapitalization(key == "country" ? .words : .never).autocorrectionDisabled()
                    .submitLabel(.done).onSubmit { commit() }
                    .focused($focused)
                    .onChange(of: input) { _, v in if v.contains(where: { $0 == "," || $0 == "/" }) { commit(final: false) } }
                    .onChange(of: focused) { _, f in if !f { commit() } }
                    .dsField()
                let hints = suggestions
                if !hints.isEmpty {
                    FlowLayout { ForEach(hints, id: \.self) { g in TagChip(text: g) { pick(g) } } }
                        .padding(.top, DS.Space.space1)
                }
            }
            if let note { Text(note).font(T.caption).foregroundStyle(DS.Color.inkMuted) }
        }
        .task(id: library.songs.count) { await loadGenres() }
        .onDisappear { commit() }
    }
}

@MainActor
enum GenreCache {
    private static var list: [String] = []
    private static var songCount = -1

    static func value(for count: Int) -> [String]? { songCount == count && !list.isEmpty ? list : nil }

    static func store(_ genres: [String], for count: Int) {
        list = genres
        songCount = genres.isEmpty ? -1 : count
    }
}

/// Splits `input` on commas and slashes into `key:` tags (genres lowercased, countries via `countryCode`), skipping duplicates and unknown countries; returns a note when something was refused. Unless `final`, the text after the last separator stays in `input`.
@discardableResult
func commitNamespaced(_ tags: inout [String], key: String, cap: Int, input: inout String, final: Bool = true) -> String? {
    var parts = input.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "," || $0 == "/" }).map { $0.trimmingCharacters(in: .whitespaces) }
    let rest = final ? "" : (parts.popLast() ?? "")
    var note: String?
    for raw in parts where !raw.isEmpty {
        let value: String? = key == "country" ? countryCode(raw) : raw.lowercased()
        guard let value else { note = "Unknown country"; continue }
        let tag = "\(key):\(value)"
        if hasTag(tags, tag) { continue }
        guard tags.filter({ tagKey($0) == key }).count < cap else { note = "Up to \(cap)"; break }
        tags.append(tag)
    }
    input = rest
    return note
}

/// Tags plus whatever is still typed in the tag field.
func finalTags(_ tags: [String], pending: String) -> [String] {
    var out = tags
    for t in splitTagInput(pending).tags where !out.contains(where: { $0.lowercased() == t.lowercased() }) { out.append(t) }
    return out
}

/// A song's tags as removable pills with the "+" after them; the last pill and the "+" wrap together, so the "+" is never alone on a line.
struct TagFlow: View {
    let tags: [String]
    var removable = false
    var adding: Bool
    let onRemove: (String) -> Void
    let onAdd: () -> Void

    var body: some View {
        FlowLayout {
            ForEach(tags.dropLast(), id: \.self) { t in TagPill(text: tagLabel(t), removable: removable) { onRemove(t) } }
            HStack(spacing: DS.Space.space2) {
                if let last = tags.last { TagPill(text: tagLabel(last), removable: removable) { onRemove(last) } }
                AddTagButton(open: adding, action: onAdd)
            }
        }
    }
}
