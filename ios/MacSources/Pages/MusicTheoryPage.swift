import SwiftUI

@MainActor
final class ThyModel: ObservableObject {
    enum Phase<T> { case loading, failed, loaded(T) }

    @Published var terms: Phase<[Thy.Term]> = .loading
    @Published var anatomy: Phase<Thy.Anatomy> = .loading

    func load(_ baseURL: String) async {
        let fetch: Thy.Fetch = { path in
            guard var c = URLComponents(string: baseURL) else { throw APIError.badURL }
            c.path = path
            guard let url = c.url else { throw APIError.badURL }
            let (data, response) = try await URLSession.shared.data(from: url)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        async let t: Void = loadTerms(fetch)
        async let a: Void = loadAnatomy(fetch)
        _ = await (t, a)
    }

    private func loadTerms(_ fetch: Thy.Fetch) async {
        do { terms = .loaded(try await Thy.loadTerms(fetch)) } catch { if !Task.isCancelled { terms = .failed } }
    }

    private func loadAnatomy(_ fetch: Thy.Fetch) async {
        do {
            let data = try await Thy.loadAnatomy(fetch)
            if data.examples.isEmpty { throw ThyJSONError.bad }
            anatomy = .loaded(data)
        } catch { if !Task.isCancelled { anatomy = .failed } }
    }
}

struct MusicTheoryPage: View {
    @EnvironmentObject var settings: Settings
    @StateObject private var model = ThyModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space5) {
                header
                termsSection
                anatomySection
            }
            .padding(.horizontal, DS.Space.space6).padding(.top, DS.Space.space6).padding(.bottom, DS.Space.space4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(DS.Color.ground)
        .navigationTitle("Music theory")
        .task(id: settings.serverURL) { await model.load(settings.serverURL) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DS.Space.space1) {
            Text("ELECTROPHONE").font(DS.Font.eyebrow).tracking(DS.Font.eyebrowTracking).foregroundStyle(DS.Color.accentInk)
            Text("Music theory").font(DS.Font.display).foregroundStyle(DS.Color.ink)
        }
        .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(DS.Font.body).foregroundStyle(DS.Color.inkMuted)
    }

    @ViewBuilder private var termsSection: some View {
        switch model.terms {
        case .loading: note("Loading...")
        case .failed: note(Thy.failText)
        case let .loaded(terms):
            if terms.isEmpty {
                note(Thy.emptyText)
            } else {
                VStack(spacing: DS.Space.space3) {
                    ForEach(terms) { t in
                        VStack(alignment: .leading, spacing: DS.Space.space1) {
                            Text(t.term).font(DS.Font.title).foregroundStyle(DS.Color.ink)
                            Text(t.description).font(DS.Font.body).foregroundStyle(DS.Color.inkMuted)
                        }
                        .textSelection(.enabled)
                        .padding(DS.Space.space4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: DS.Radius.radiusCard, style: .continuous).fill(DS.Color.surface)
                            .shadow(color: DS.Color.vinyl.opacity(0.16), radius: 10, y: 2))
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private var anatomySection: some View {
        VStack(alignment: .leading, spacing: DS.Space.space4) {
            Text(Thy.anatomyTitle).font(DS.Font.title).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
            note(Thy.anatomyIntro)
            switch model.anatomy {
            case .loading: note("Loading...")
            case .failed: note(Thy.anatomyFailText)
            case let .loaded(data): ThyAnatomyView(data: data)
            }
        }
        .padding(.top, DS.Space.space8 - DS.Space.space5)
    }
}
