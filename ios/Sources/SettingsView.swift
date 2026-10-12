import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @State private var status: String?
    @State private var testing = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("https://play.isayenko.net", text: $settings.serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    SecureField("API token", text: $settings.token)
                    Button { Task { await test() } } label: {
                        HStack {
                            Text("Test connection")
                            if testing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(testing)
                    if let status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                }
                Section("Storage") {
                    LabeledContent("Downloaded songs", value: "\(library.tracks.count)")
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func test() async {
        testing = true
        defer { testing = false }
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).health()
            status = "Server reachable"
        } catch { status = error.localizedDescription }
    }
}
