import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var server: ServerLink
    @ObservedObject private var auth = AuthService.shared
    @Environment(\.colorScheme) private var scheme
    @State private var status: String?
    @State private var testing = false
    @State private var ok = false
    @State private var bytes: Int64 = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                ScreenHeader(title: "Settings", subtitle: "One server. Songs stay on this iPhone.")
                serverCard
                accountCard
                storageCard
                Text("Electrophone \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                    .dsCaption().padding(.horizontal, DS.Space.space1)
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .scrollDismissesKeyboard(.interactively)
        .dsGround()
        .task { await server.check(settings: settings) }
        .task(id: library.tracks.count) {
            bytes = await Task.detached(priority: .utility) { [tracks = library.tracks] in
                tracks.reduce(Int64(0)) { $0 + Int64((try? FileManager.default.attributesOfItem(atPath: $1.fileURL.path)[.size] as? Int) ?? 0) }
            }.value
        }
    }

    private func card<C: View>(_ label: String, footer: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            SectionLabel(label)
            VStack(alignment: .leading, spacing: DS.Space.space3, content: content)
                .padding(DS.Space.space4).frame(maxWidth: .infinity, alignment: .leading).dsSlab()
            if let footer { Text(footer).dsCaption().padding(.horizontal, DS.Space.space1) }
        }
    }

    private var serverCard: some View {
        card("Private server") {
            VStack(alignment: .leading, spacing: 2) {
                Text("Server URL").dsCaption()
                TextField("https://play.isayenko.net", text: $settings.serverURL)
                    .textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled().dsField()
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("API token").dsCaption()
                SecureField("API token", text: $settings.token).dsField()
            }
            Button("Paste token from clipboard") {
                if let s = UIPasteboard.general.string { settings.token = s.trimmingCharacters(in: .whitespacesAndNewlines) }
            }
            .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
            Button { Task { await test() } } label: {
                HStack { Text("Test connection"); if testing { ProgressView() } }
            }
            .buttonStyle(DSButtonStyle(kind: .quiet)).disabled(testing)
            ServerStatus()
            if let status {
                Label {
                    Text(status).font(T.caption).foregroundStyle(DS.Color.ink)
                } icon: {
                    Image(systemName: ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .foregroundStyle(ok ? DS.Color.ok : DS.Color.power)
                }
            }
        }
    }

    private var accountCard: some View {
        card("Account", footer: "Owner only. Downloaded songs play offline without signing in.") {
            if let session = auth.session {
                HStack(spacing: DS.Space.space3) {
                    LED(color: auth.expired ? DS.Color.power : DS.Color.ok, size: 10, glow: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.email ?? "Signed in").font(T.body).foregroundStyle(DS.Color.ink)
                        Text(auth.expired ? "Expired, sign in again" : "via \(session.provider == .apple ? "Apple" : "Google")").dsCaption()
                    }
                }
                .accessibilityElement(children: .combine)
                Button("Sign out") { auth.signOut() }.buttonStyle(DSButtonStyle(kind: .danger))
            }
            if !auth.isSignedIn || auth.expired {
                SignInWithAppleButton(.signIn) { $0.requestedScopes = [.email] } onCompletion: { auth.apple($0) }
                    .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
                    .frame(height: 48).clipShape(Capsule())
                GoogleSignInButton { Task { await auth.signInWithGoogle() } }.disabled(auth.busy)
            }
            if let e = auth.error {
                Label { Text(e).font(T.caption).foregroundStyle(DS.Color.ink) } icon: {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(DS.Color.power)
                }
            }
        }
    }

    private var storageCard: some View {
        card("Storage") {
            HStack(alignment: .firstTextBaseline) {
                Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)).font(T.title).foregroundStyle(DS.Color.ink)
                Spacer()
                Text("\(library.tracks.count) \(library.tracks.count == 1 ? "song" : "songs") on iPhone").dsCaption()
            }
            .accessibilityElement(children: .combine)
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
            server.setReachable(true)
        } catch {
            ok = false
            status = error.localizedDescription
            server.setReachable(false)
        }
    }
}

/// Google sign-in as a quiet outlined pill: surface key, ink label.
struct GoogleSignInButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.Space.space3) {
                Text("G").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(DS.Color.accentInk)
                Text("Sign in with Google").font(T.headline).foregroundStyle(DS.Color.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Capsule().fill(DS.Color.surfaceKey))
            .overlay(Capsule().stroke(DS.Color.line, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }
}
