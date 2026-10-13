import SwiftUI

struct SearchView: View {
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var settings: Settings
    @State private var query = ""
    @State private var results: [SearchResult] = []
    @State private var searching = false
    @State private var downloading: Set<String> = []
    @State private var failed: [String: String] = [:]
    @State private var error: String?
    @State private var searchError: SearchFailure?
    @State private var searched = false
    @State private var lastQuery = ""
    var onPick: ((SearchResult) -> Void)?

    private var api: APIClient { APIClient(baseURL: settings.serverURL, token: settings.token) }

    var body: some View {
        List(results) { result in
            HStack {
                Button { onPick?(result) } label: {
                    SongRow(title: result.title,
                            subtitle: [result.artist, result.duration.map(formatTime)].compactMap { $0 }.joined(separator: " · "),
                            thumbnail: result.thumbnail, coverSize: 48)
                }
                .buttonStyle(.plain)
                if library.contains(result.id) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(DS.Color.accentInk)
                        .frame(width: DS.Space.hit, height: DS.Space.hit).accessibilityLabel("On iPhone")
                } else if downloading.contains(result.id) {
                    ProgressView().frame(width: DS.Space.hit, height: DS.Space.hit)
                } else {
                    Button { Task { await download(result) } } label: {
                        Image(systemName: failed[result.id] == nil ? "arrow.down.circle" : "exclamationmark.arrow.circlepath")
                            .foregroundStyle(DS.Color.accentInk).frame(width: DS.Space.hit, height: DS.Space.hit)
                    }
                    .buttonStyle(.borderless).accessibilityLabel(failed[result.id] == nil ? "Download" : "Retry download")
                }
            }
            .listRowInsets(EdgeInsets()).listRowBackground(DS.Color.surface).listRowSeparatorTint(DS.Color.line)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .dsGround()
        .overlay {
            if searching { ProgressView().accessibilityLabel("Searching") }
            else if let f = searchError { failureView(f) }
            else if results.isEmpty {
                Text(searched ? "No results" : "Search YouTube by title; tap a result to preview it")
                    .font(T.body).foregroundStyle(DS.Color.inkMuted)
                    .multilineTextAlignment(.center).padding()
            }
        }
        .navigationTitle("Search YouTube")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Songs, artists")
        .onSubmit(of: .search) { Task { await search(force: true) } }
        .task(id: query) {
            guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { searching = false; return }
            try? await Task.sleep(nanoseconds: 600_000_000)
            if !Task.isCancelled { await search() }
        }
        .alert("Error", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(error ?? "") }
    }

    struct SearchFailure { let message: String; let canRetry: Bool }

    private func failureView(_ f: SearchFailure) -> some View {
        VStack(spacing: DS.Space.space3) {
            Label { Text(f.message).font(T.body).foregroundStyle(DS.Color.ink) } icon: {
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(DS.Color.power)
            }
            if f.canRetry {
                Button("Retry") { Task { await search(force: true) } }.buttonStyle(DSButtonStyle(kind: .outline))
            }
        }
        .multilineTextAlignment(.center).padding()
    }

    private func search(force: Bool = false) async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        if !force, q == lastQuery, searchError == nil { return }
        lastQuery = q
        searching = true
        searchError = nil
        do {
            let r = try await api.search(q)
            guard q == lastQuery else { return }
            results = r; searched = true
        } catch is CancellationError { return
        } catch let e as URLError where e.code == .cancelled { return
        } catch {
            guard q == lastQuery else { return }
            results = []
            var canRetry = true
            if case APIError.http(401, _) = error { canRetry = false }
            searchError = SearchFailure(message: error.localizedDescription, canRetry: canRetry)
        }
        searching = false
    }

    private func download(_ result: SearchResult) async {
        downloading.insert(result.id)
        defer { downloading.remove(result.id) }
        do {
            library.add(try await api.download(result))
            failed[result.id] = nil
        } catch {
            failed[result.id] = error.localizedDescription
            self.error = error.localizedDescription
        }
    }
}
