import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var server: ServerLink
    @ObservedObject private var auth = AuthService.shared
    @Environment(\.colorScheme) private var scheme
    @State private var bytes: Int64 = 0
    @State private var confirmRemoveAll = false
    @State private var confirmReset = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space4) {
                ScreenHeader(title: "Settings")
                accountCard
                downloadsCard
                storageCard
                Text(versionLine).dsCaption().frame(maxWidth: .infinity)
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .scrollDismissesKeyboard(.interactively)
        .dsGround()
        .confirmationDialog("Remove all \(library.tracks.filter { $0.localOnly != true }.count) downloads from this iPhone?", isPresented: $confirmRemoveAll, titleVisibility: .visible) {
            Button("Remove all downloads", role: .destructive) { library.removeAllAudio() }
        } message: { Text("The songs stay in your library. Tap Download to get one back.") }
        .confirmationDialog("Reset to the default server?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset", role: .destructive) { settings.resetConnection(); Task { await server.check(settings: settings) } }
        } message: { Text("This clears the saved server address and token. Your songs stay.") }
        .task { await server.check(settings: settings) }
        .onChange(of: auth.session?.email) { _, _ in server.clearForbidden(); Task { await server.check(settings: settings) } }
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
        var line = "Electrophone \(v) (\(b))"
        if info.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" {
            line += " \u{00B7} TestFlight"
        } else {
            #if DEBUG
            line += " \u{00B7} Debug"
            #endif
        }
        return line
    }

    /// A grouped card: section label above, surface slab with 16pt side padding, rows or content inside.
    private func card<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(label)
            VStack(alignment: .leading, spacing: 0, content: content)
                .padding(.horizontal, DS.Space.space4)
                .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
        }
    }

    private var rule: some View { Rectangle().fill(DS.Color.line).frame(height: 1) }

    /// A 48pt settings row: label on the left, value or control on the right.
    private func row<Trail: View>(_ label: String, @ViewBuilder trailing: () -> Trail) -> some View {
        HStack(spacing: DS.Space.space3) {
            Text(label).font(T.subhead).foregroundStyle(DS.Color.ink)
            Spacer(minLength: DS.Space.space2)
            trailing()
        }
        .frame(minHeight: 48)
    }

    private var downloadsCard: some View {
        card("Downloads") {
            row("Audio quality") {
                HStack(spacing: 6) {
                    Text("High \u{00B7} 192 kbps").font(T.subhead).foregroundStyle(DS.Color.inkMuted)
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(DS.Color.inkFaint)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityElement(children: .combine)
            rule
            row("Download new songs automatically") {
                Toggle("Download new songs automatically", isOn: $settings.downloadNewAutomatically)
                    .labelsHidden().toggleStyle(DSSwitchStyle())
            }
            .accessibilityElement(children: .combine)
            rule
            row("Use mobile data") {
                Toggle("Use mobile data", isOn: $settings.useMobileData).labelsHidden().toggleStyle(DSSwitchStyle())
            }
            .accessibilityElement(children: .combine)
            if settings.hasCustomConnection {
                rule
                row("Custom server: \(settings.customServerLabel)") {
                    Button("Reset") { confirmReset = true }.font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                        .frame(minHeight: DS.Space.hit)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var accountLEDColor: Color {
        auth.expired || server.forbidden ? DS.Color.power : server.ledColor
    }

    private func accountStatus(_ session: AuthService.Session) -> String {
        if auth.expired { return "Expired, sign in again" }
        if server.forbidden { return "Not allowed on this server" }
        return "via \(session.provider == .apple ? "Apple" : "Google")"
    }

    private var accountCard: some View {
        card("Account") {
            VStack(alignment: .leading, spacing: DS.Space.space3) {
                if let session = auth.session {
                    HStack(spacing: DS.Space.space3) {
                        LED(color: accountLEDColor, size: 10, glow: server.reachable != nil)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.email ?? "Signed in").font(T.body).foregroundStyle(DS.Color.ink)
                            Text(accountStatus(session)).dsCaption()
                        }
                    }
                    .accessibilityElement(children: .combine)
                    Button("Sign out") { auth.signOut(); server.clearForbidden() }.buttonStyle(DSButtonStyle(kind: .danger))
                }
                if !auth.isSignedIn || auth.expired {
                    VStack(spacing: DS.Space.space2) {
                        SignInWithAppleButton(.signIn) { $0.requestedScopes = [.email] } onCompletion: { auth.apple($0) }
                            .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
                            .id(scheme)
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
            .padding(.vertical, DS.Space.space3)
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
                Button { confirmRemoveAll = true } label: { Text("Remove all downloads").frame(maxWidth: .infinity) }
                    .buttonStyle(DSButtonStyle(kind: .danger)).disabled(library.tracks.isEmpty)
                    .padding(.top, DS.Space.space1)
            }
            .padding(.vertical, DS.Space.space3)
            .accessibilityElement(children: .contain)
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
