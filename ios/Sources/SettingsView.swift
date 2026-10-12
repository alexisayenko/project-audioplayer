import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @ObservedObject private var auth = AuthService.shared
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
                    if let session = auth.session {
                        HStack {
                            LED(on: !auth.expired, color: auth.expired ? Theme.red : Theme.green, size: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.email ?? "Signed in").foregroundStyle(Theme.label)
                                Text(auth.expired ? "Expired, sign in again" : "via \(session.provider == .apple ? "Apple" : "Google")")
                                    .font(.caption).foregroundStyle(Theme.labelDim)
                            }
                        }
                        Button("Sign out", role: .destructive) { auth.signOut() }
                    }
                    if !auth.isSignedIn || auth.expired {
                        SignInWithAppleButton(.signIn) { $0.requestedScopes = [.email] } onCompletion: { auth.apple($0) }
                            .signInWithAppleButtonStyle(.white)
                            .frame(height: 44)
                        GoogleSignInButton { Task { await auth.signInWithGoogle() } }
                            .disabled(auth.busy)
                    }
                    if let e = auth.error { Text(e).font(.caption).foregroundStyle(Theme.red) }
                } header: { Text("Account · УЧЁТКА").panelLabel() }
                footer: { Text("Owner only. Downloaded songs play offline without signing in.").foregroundStyle(Theme.labelDim) }
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

/// Google's light button: white pill, multicolour "G", the standard label.
struct GoogleSignInButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text("G").font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(LinearGradient(
                        colors: [Color(red: 0.26, green: 0.52, blue: 0.96), Color(red: 0.92, green: 0.26, blue: 0.21),
                                 Color(red: 0.98, green: 0.74, blue: 0.02), Color(red: 0.2, green: 0.66, blue: 0.33)],
                        startPoint: .topTrailing, endPoint: .bottomLeading))
                Text("Sign in with Google").font(.system(size: 17, weight: .medium)).foregroundStyle(Color(white: 0.12))
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.white))
        }
        .buttonStyle(.plain)
    }
}
