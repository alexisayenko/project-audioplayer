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
    @State private var confirmRemoveAll = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                ScreenHeader(title: "Settings")
                accountCard
                storageCard
                serverCard
                Text(versionLine).dsCaption().frame(maxWidth: .infinity)
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .scrollDismissesKeyboard(.interactively)
        .dsGround()
        .confirmationDialog("Remove all \(library.tracks.count) songs from this iPhone?", isPresented: $confirmRemoveAll, titleVisibility: .visible) {
            Button("Remove all downloads", role: .destructive) { library.remove(at: IndexSet(library.tracks.indices)) }
        } message: { Text("Your server keeps them. Add a song again to download it.") }
        .task { await server.check(settings: settings) }
        .task(id: library.tracks.count) {
            bytes = await Task.detached(priority: .utility) { [tracks = library.tracks] in
                tracks.reduce(Int64(0)) { $0 + Int64((try? FileManager.default.attributesOfItem(atPath: $1.fileURL.path)[.size] as? Int) ?? 0) }
            }.value
        }
    }

    private var versionLine: String {
        let info = Bundle.main
        let v = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let b = info.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        let testFlight = info.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        return "Electrophone \(v) (\(b))" + (testFlight ? " · TestFlight" : "")
    }

    private func card<C: View>(_ label: String, footer: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(label)
            VStack(alignment: .leading, spacing: DS.Space.space3, content: content)
                .padding(.horizontal, DS.Space.space4).padding(.vertical, DS.Space.space3)
                .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
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
        card("Account") {
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
                VStack(spacing: DS.Space.space2) {
                    SignInWithAppleButton(.signIn) { $0.requestedScopes = [.email] } onCompletion: { auth.apple($0) }
                        .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
                        .frame(height: DS.Space.hit).clipShape(Capsule())
                    GoogleSignInButton { Task { await auth.signInWithGoogle() } }.disabled(auth.busy)
                }
            }
            if let e = auth.error {
                Label { Text(e).font(T.caption).foregroundStyle(DS.Color.ink) } icon: {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(DS.Color.power)
                }
            }
        }
    }

    private var capacity: Int64 {
        let v = try? URL(fileURLWithPath: NSHomeDirectory()).resourceValues(forKeys: [.volumeTotalCapacityKey]).volumeTotalCapacity
        return Int64(v ?? 0)
    }

    private var storageCard: some View {
        card("Storage") {
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)).font(T.title).foregroundStyle(DS.Color.ink)
                    Spacer()
                    Text("\(library.tracks.count) \(library.tracks.count == 1 ? "song" : "songs") on iPhone").dsCaption()
                }
                if capacity > 0 {
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(DS.Color.surfaceSunken)
                            Capsule().fill(DS.Color.accent).frame(width: max(6, g.size.width * min(1, Double(bytes) / Double(capacity))))
                        }
                    }
                    .frame(height: 6).accessibilityHidden(true)
                    Text("of \(ByteCountFormatter.string(fromByteCount: capacity, countStyle: .file)) on this iPhone").dsCaption()
                }
                Button("Remove all downloads") { confirmRemoveAll = true }
                    .buttonStyle(DSButtonStyle(kind: .danger)).disabled(library.tracks.isEmpty)
                    .padding(.top, DS.Space.space1)
            }
            .accessibilityElement(children: .contain)
        }
    }

    private func test() async {
        testing = true
        status = nil
        defer { testing = false }
        let started = Date()
        do {
            try await APIClient(baseURL: settings.serverURL, token: settings.token).verify()
            ok = true
            status = "Connected · \(Int(Date().timeIntervalSince(started) * 1000)) ms, token accepted"
            server.setReachable(true)
        } catch {
            ok = false
            status = error.localizedDescription
            server.setReachable(false)
        }
    }
}

/// Google sign-in as an outlined pill: line border, ink label.
struct GoogleSignInButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.Space.space2) {
                Text("G").font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(DS.Color.accentInk)
                Text("Sign in with Google").font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
            }
            .frame(maxWidth: .infinity, minHeight: DS.Space.hit)
            .overlay(Capsule().stroke(DS.Color.line, lineWidth: 1.5))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
