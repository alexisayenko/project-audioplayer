import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @State private var status: String?
    @State private var testing = false
    @State private var ok = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://play.isayenko.net", text: $settings.serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    SecureField("API token", text: $settings.token)
                    Button("Paste token from clipboard") {
                        if let s = UIPasteboard.general.string {
                            settings.token = s.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                    }
                    Button { Task { await test() } } label: {
                        HStack {
                            Text("Test connection")
                            if testing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(testing)
                    if let status {
                        HStack {
                            LED(on: true, color: ok ? Theme.green : Theme.red, size: 12)
                            Label(status, systemImage: ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                                .foregroundStyle(ok ? Theme.green : Theme.red)
                        }
                    }
                } header: { Text("Server · ВХОД").panelLabel() }
                .listRowBackground(Theme.panelRaised)
                Section {
                    LabeledContent("Downloaded songs", value: "\(library.tracks.count)")
                } header: { Text("Storage · ХРАНИЛИЩЕ").panelLabel() }
                .listRowBackground(Theme.panelRaised)
            }
            .scrollContentBackground(.hidden)
            .panelBackground()
            .tint(Theme.cyan)
            .foregroundStyle(Theme.label)
            .navigationBarTitleDisplayMode(.inline)
            .woodBar(.navigationBar)
            .navigationTitle("Settings")
        }
    }

    private func test() async {
        testing = true
        status = nil
        defer { testing = false }
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).verify()
            ok = true
            status = "Connected, token accepted"
        } catch {
            ok = false
            status = error.localizedDescription
        }
    }
}
