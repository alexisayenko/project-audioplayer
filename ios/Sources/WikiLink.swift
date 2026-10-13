import SwiftUI

private let wikiPrefix = "https://en.wikipedia.org/wiki/"

func wikiDisplay(_ url: String) -> String {
    guard let r = url.range(of: #"^https?://(m\.)?en\.wikipedia\.org/wiki/(.+)$"#, options: [.regularExpression, .caseInsensitive]),
          let slash = url[r].range(of: "/wiki/", options: .caseInsensitive) else { return url }
    var title = String(url[slash.upperBound...])
    if let cut = title.firstIndex(where: { $0 == "#" || $0 == "?" }) { title = String(title[..<cut]) }
    guard !title.isEmpty else { return url }
    return (title.removingPercentEncoding ?? title).replacingOccurrences(of: "_", with: " ")
}

func wikiNormalize(_ text: String) -> String {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return "" }
    if t.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil { return t }
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "()',.:!*~-_")
    let name = t.replacingOccurrences(of: " ", with: "_").addingPercentEncoding(withAllowedCharacters: allowed) ?? t
    return wikiPrefix + name
}

struct WikiLinkField: View {
    let title: String
    @Binding var value: String
    @State private var text: String
    @FocusState private var focused: Bool

    init(title: String, value: Binding<String>) {
        self.title = title
        _value = value
        _text = State(initialValue: wikiDisplay(value.wrappedValue))
    }

    var body: some View {
        TextField(title, text: $text, prompt: Text("Article name or link"))
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled(true)
            .submitLabel(.done).focused($focused).dsField()
            .onSubmit(commit)
            .onChange(of: focused) { _, now in if !now { commit() } }
            .onChange(of: value) { _, _ in if !focused { text = wikiDisplay(value) } }
    }

    private func commit() {
        if text != wikiDisplay(value) { value = wikiNormalize(text) }
        text = wikiDisplay(value)
    }
}

#if DEBUG
func wikiLinkSelfCheck() -> [String] {
    var fails: [String] = []
    func eq(_ got: String, _ want: String, _ name: String) { if got != want { fails.append("\(name): got \(got) want \(want)") } }
    let w = "https://en.wikipedia.org/wiki/"
    eq(wikiDisplay(w + "Crazy"), "Crazy", "plain")
    eq(wikiDisplay(w + "Warrior%27s_Dance"), "Warrior's Dance", "percent")
    eq(wikiDisplay(w + "The_Prodigy"), "The Prodigy", "underscores")
    eq(wikiDisplay(w + "Foo_Bar#History"), "Foo Bar", "fragment")
    eq(wikiDisplay(w + "Foo?x=1"), "Foo", "query")
    eq(wikiDisplay("https://m.EN.wikipedia.org/wiki/Foo"), "Foo", "mobile host")
    eq(wikiDisplay("https://de.wikipedia.org/wiki/Foo"), "https://de.wikipedia.org/wiki/Foo", "non-en")
    eq(wikiDisplay("https://www.wikidata.org/wiki/Q1"), "https://www.wikidata.org/wiki/Q1", "wikidata")
    eq(wikiDisplay(w + "100%_sure"), "100% sure", "malformed %")
    eq(wikiNormalize(""), "", "empty")
    eq(wikiNormalize("  "), "", "blank")
    eq(wikiNormalize(" https://de.wikipedia.org/wiki/Foo "), "https://de.wikipedia.org/wiki/Foo", "full url")
    eq(wikiNormalize("Warrior's Dance"), w + "Warrior's_Dance", "apostrophe")
    eq(wikiNormalize("Crazy (Gnarls Barkley song)"), w + "Crazy_(Gnarls_Barkley_song)", "parentheses")
    eq(wikiNormalize("AC/DC"), w + "AC%2FDC", "slash")
    return fails
}
#endif
