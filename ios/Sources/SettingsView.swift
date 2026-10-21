import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var server: ServerLink
    @ObservedObject private var auth = AuthService.shared
    @Environment(\.colorScheme) private var scheme
    @State private var bytes: Int64 = 0
    @State private var freeBytes: Int64 = 0
    @State private var confirmRemoveAll = false
    @State private var removedTick = 0
    @State private var confirmReset = false
    @State private var filesTick = 0
    @State private var filesNotice: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space3) {
                ScreenHeader(title: "Settings")
                accountCard
                downloadsCard
                storageCard
                Text(versionLine).font(DS.Dynamic.micro).foregroundStyle(DS.Color.inkMuted).frame(maxWidth: .infinity)
                    .padding(.top, DS.Space.space4)
            }
            .padding(.horizontal, DS.Space.space4).padding(.top, DS.Space.space2).padding(.bottom, DS.Space.space4)
        }
        .scrollDismissesKeyboard(.interactively)
        .sensoryFeedback(.success, trigger: removedTick)
        .sensoryFeedback(.selection, trigger: filesTick)
        .dsGround()
        .confirmationDialog("Remove all \(library.tracks.filter { $0.localOnly != true }.count) downloads from this iPhone?", isPresented: $confirmRemoveAll, titleVisibility: .visible) {
            Button("Remove all downloads", role: .destructive) { library.removeAllAudio(); removedTick += 1 }
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
            freeBytes = await Task.detached(priority: .utility) { Self.freeSpace() }.value
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
        VStack(alignment: .leading, spacing: DS.Space.space2) {
            SectionLabel(label)
            VStack(alignment: .leading, spacing: 0, content: content)
                .padding(.horizontal, DS.Space.space4)
                .frame(maxWidth: .infinity, alignment: .leading).dsSlab()
        }
    }

    private var rule: some View { Rectangle().fill(DS.Color.line).frame(height: 1) }

    /// A 48pt settings row: label on the left, value or control on the right.
    private func row<Trail: View>(_ label: String, color: Color = DS.Color.ink, @ViewBuilder trailing: () -> Trail) -> some View {
        HStack(spacing: DS.Space.space3) {
            Text(label).font(T.subhead).foregroundStyle(color)
            Spacer(minLength: DS.Space.space2)
            trailing()
        }
        .frame(minHeight: 48)
    }

    private var downloadsCard: some View {
        card("Downloads") {
            row("Audio format") {
                Text("AAC \u{00B7} best available").font(T.subhead).foregroundStyle(DS.Color.inkMuted)
            }
            .accessibilityElement(children: .combine)
            rule
            row("Download new songs automatically") {
                Toggle("Download new songs automatically", isOn: $settings.downloadNewAutomatically)
                    .labelsHidden().toggleStyle(DSSwitchStyle())
            }
            .accessibilityElement(children: .combine)
            rule
            row("Download over mobile data") {
                Toggle("Download over mobile data", isOn: $settings.useMobileData).labelsHidden().toggleStyle(DSSwitchStyle())
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
                    Button("Sign out") { auth.signOut(); server.cancelBackgroundWork(); server.clearForbidden() }.buttonStyle(DSButtonStyle(kind: .danger))
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

    private nonisolated static func freeSpace() -> Int64 {
        let keys: Set<URLResourceKey> = [.volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey]
        guard let v = try? URL(fileURLWithPath: NSHomeDirectory()).resourceValues(forKeys: keys) else { return 0 }
        return v.volumeAvailableCapacityForImportantUsage ?? Int64(v.volumeAvailableCapacity ?? 0)
    }

    private var lowSpace: Bool { freeBytes > 0 && freeBytes < 1_000_000_000 }

    private func sizeText(_ n: Int64) -> String { ByteCountFormatter.string(fromByteCount: n, countStyle: .file) }

    private var missingCount: Int {
        library.songs.filter { $0.onServer != false && $0.localOnly != true && !library.contains($0.id) }.count
    }

    private func linkRow(_ title: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            row(title) {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(DS.Color.inkFaint)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }

    @ViewBuilder
    private var downloadAllRow: some View {
        let b = server.bulk
        if b.running {
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                ProgressView(value: b.fraction).tint(DS.Color.accent)
                HStack {
                    Text("Downloading \(b.processed) of \(b.total)\(b.failed > 0 ? ", \(b.failed) failed" : "")").dsCaption()
                    Spacer()
                    Button("Cancel") { server.cancelDownloadAll() }
                        .font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.accentInk).frame(minHeight: DS.Space.hit)
                }
            }
            .padding(.vertical, DS.Space.space3)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                linkRow("Download all to iPhone", enabled: missingCount > 0 && server.reachable != false) {
                    Task { await server.downloadAllMissing(settings: settings, library: library) }
                }
                if b.hasResult {
                    Text(b.summary).dsCaption().padding(.bottom, DS.Space.space3)
                } else if missingCount == 0 {
                    Text("Everything on the server is already on this iPhone.").dsCaption().padding(.bottom, DS.Space.space3)
                }
            }
        }
    }

    #if os(iOS)
    private var openInFilesRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            linkRow("Open in Files") {
                filesTick += 1
                filesNotice = nil
                let path = LibraryStore.documents.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
                guard let url = URL(string: "shareddocuments://" + path) else { filesNotice = Self.filesHint; return }
                openURL(url) { if !$0 { filesNotice = Self.filesHint } }
            }
            .accessibilityLabel("Open downloaded songs in Files")
            if let filesNotice { Text(filesNotice).dsCaption().fixedSize(horizontal: false, vertical: true).padding(.bottom, DS.Space.space3) }
        }
    }

    private static let filesHint = "Open Files > On My iPhone > Electrophone"
    #else
    private var openInFilesRow: some View { EmptyView() }
    #endif

    private var storageCard: some View {
        card("Storage") {
            VStack(alignment: .leading, spacing: DS.Space.space2) {
                (Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)).font(T.title).foregroundColor(DS.Color.ink)
                    + Text(" \u{00B7} Downloaded audio").font(T.subhead).foregroundColor(DS.Color.inkMuted))
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(library.tracks.count) \(library.tracks.count == 1 ? "song" : "songs") on iPhone").dsCaption()
                if freeBytes > 0 {
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(DS.Color.surfaceSunken)
                            Capsule().fill(lowSpace ? DS.Color.power : DS.Color.accent)
                                .frame(width: max(6, g.size.width * Double(bytes) / Double(max(1, bytes + freeBytes))))
                        }
                    }
                    .frame(height: 6).accessibilityHidden(true)
                    Text("\(sizeText(freeBytes)) free on this iPhone")
                        .font(T.caption).foregroundStyle(lowSpace ? DS.Color.powerText : DS.Color.inkMuted)
                        .accessibilityLabel("\(sizeText(bytes)) of downloaded audio, \(sizeText(freeBytes)) free\(lowSpace ? ", low space" : "")")
                }
                Text("AAC audio \u{00B7} quality depends on the source").dsCaption().fixedSize(horizontal: false, vertical: true)
                    .accessibilityHint("Saved as AAC (m4a) at the best quality the source provides: usually 128 kbps, sometimes 160, 192 or more.")
            }
            .padding(.vertical, DS.Space.space4)
            .accessibilityElement(children: .contain)
            if auth.isSignedIn { rule; downloadAllRow }
            #if os(iOS)
            rule
            openInFilesRow
            #endif
            rule
            Button { confirmRemoveAll = true } label: {
                row("Remove all downloads", color: library.tracks.isEmpty ? DS.Color.inkFaint : DS.Color.powerText) { EmptyView() }
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(library.tracks.isEmpty)
        }
    }
}

/// Google sign-in as an outlined pill: line border, ink label.
struct GoogleSignInButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.Space.space2) {
                Text("G").font(.system(.body, design: .rounded, weight: .bold)).foregroundStyle(DS.Color.accentInk)
                Text("Sign in with Google").font(T.subhead.weight(.semibold)).foregroundStyle(DS.Color.ink)
            }
            .frame(maxWidth: .infinity, minHeight: DS.Space.hit)
            .overlay(Capsule().stroke(DS.Color.line, lineWidth: 1.5))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
