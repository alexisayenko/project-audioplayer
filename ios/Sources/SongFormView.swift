import SwiftUI

struct FormNote: View {
    let text: String
    var error = false

    var body: some View {
        Label {
            Text(text).font(T.caption).foregroundStyle(error ? DS.Color.ink : DS.Color.inkMuted)
        } icon: {
            Image(systemName: error ? "exclamationmark.circle.fill" : "info.circle").foregroundStyle(error ? DS.Color.power : DS.Color.inkMuted)
        }
    }
}

/// The song fields shared by the Add form and the song edit screen. Only the BPM row and Get metadata's sources differ.
struct SongFormView<BPMRow: View>: View {
    @ObservedObject var form: SongFormState
    let api: APIClient
    let sources: () -> [String]
    @ViewBuilder let bpmRow: () -> BPMRow
    @EnvironmentObject var library: LibraryStore
    @State private var addingTags = false

    private let hiddenKeys: Set<String> = ["lang", "genre", "country"]
    private var pool: [(tag: String, count: Int)] { tagCounts(library.songs.map { $0.tags ?? [] }) }

    private func labeled(_ label: String, _ text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            DSTextField(label: label, text: text, keyboard: keyboard)
        }
    }

    private func tokenField(_ kind: TokenKind, _ text: Binding<String>, _ moves: [TokenMove]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(kind.label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TokenField(kind: kind, text: text, moves: moves)
        }
    }

    private func moves(from kind: TokenKind) -> [TokenMove] {
        let texts: [TokenKind: Binding<String>] = [.title: $form.title, .artist: $form.artist, .remixer: $form.remixer]
        return [TokenKind.title, .artist, .remixer].filter { $0 != kind && !(form.remixLocked && $0 == .remixer) }
            .compactMap { k in texts[k].map { TokenMove(kind: k, text: $0) } }
    }

    private func readOnly(_ label: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            Text(text).font(T.body).foregroundStyle(DS.Color.ink)
        }
    }

    private var metadataButton: some View {
        Button { form.launch { await form.getMetadata(api: api, sources: sources()) } } label: {
            HStack { Text("Get metadata"); if form.metaBusy { ProgressView() } }
        }
        .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(form.metaBusy)
    }

    private func suggestionHint(_ h: (artist: String?, title: String?)) -> some View {
        let text = [h.artist, h.title].compactMap { $0 }.joined(separator: " / ")
        let spoken = [h.artist, h.title].compactMap { $0 }.joined(separator: " - ")
        return Button { form.applyHint() } label: {
            HStack(alignment: .firstTextBaseline, spacing: DS.Space.space2) {
                Image(systemName: "lightbulb").accessibilityHidden(true)
                Text("Wikipedia says: \(text)").multilineTextAlignment(.leading)
            }
            .font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
            .frame(maxWidth: .infinity, minHeight: DS.Space.hit, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Use Wikipedia's artist and title: \(spoken)")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.space3) {
            tokenField(.title, $form.title, moves(from: .title))
            tokenField(.artist, $form.artist, moves(from: .artist))
            if let featured = form.featuredSummary { readOnly("Featured", featured) }
            if form.remixLocked, let version = form.versionSummary {
                readOnly("Version", version)
            } else {
                tokenField(.remixer, $form.remixer, moves(from: .remixer))
            }
            if let h = form.hint { suggestionHint(h) }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: DS.Space.space3) { metadataButton; Spacer(minLength: DS.Space.space2); ServiceIconRow(busy: form.metaBusy, found: form.services) }
                FlowLayout { metadataButton; ServiceIconRow(busy: form.metaBusy, found: form.services) }
            }
            if let n = form.metaNote { FormNote(text: n, error: n == "Couldn't load metadata") }
            HStack(alignment: .top, spacing: DS.Space.space3) {
                labeled("Album", $form.album)
                labeled("Year", $form.year, keyboard: .numberPad).frame(width: 96)
            }
            bpmRow()
        }

        NamespaceField(title: "Genres", key: "genre", cap: genreCap, tags: $form.tags, input: $form.pendingGenre)
        NamespaceField(title: "Countries", key: "country", cap: countryCap, tags: $form.tags, input: $form.pendingCountry)

        VStack(alignment: .leading, spacing: DS.Space.space2) {
            Text("Tags").font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.inkMuted)
            TagFlow(tags: form.tags.filter { !hiddenKeys.contains(tagKey($0)) }, removable: true, adding: addingTags, onRemove: { t in form.tags.removeAll { $0 == t } }) {
                withAnimation { addingTags.toggle() }
            }
            if addingTags {
                TagEditor(tags: $form.tags, suggested: $form.suggested, pool: pool, input: $form.pendingTag, hiddenKeys: hiddenKeys)
            }
        }

        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: DS.Space.space3) {
                WikiLinkField(title: "Wikipedia: song", value: $form.wikiSong).frame(maxWidth: .infinity)
                WikiLinkField(title: "Wikipedia: band", value: $form.wikiArtist).frame(maxWidth: .infinity)
            }
            .frame(minWidth: 300)
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                WikiLinkField(title: "Wikipedia: song", value: $form.wikiSong)
                WikiLinkField(title: "Wikipedia: band", value: $form.wikiArtist)
            }
        }
    }
}
