import SwiftUI

struct SettingsPage: View {
    @EnvironmentObject var auth: AuthService
    @EnvironmentObject var nav: MacNavigation
    @EnvironmentObject var library: LibraryStore
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var player: PlayerService
    @ObservedObject private var ui = LibraryUIState.shared
    @State private var usage: MacAPI.Usage?
    @State private var usageFailed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.space5) {
                LibPageHeader(title: "Settings", subtitle: "Your library and storage on this server.") { EmptyView() }
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: DS.Space.space5) {
                        VStack(spacing: DS.Space.space4) { accountCard; libraryCard }
                        VStack(spacing: DS.Space.space4) { playbackCard }
                    }
                    .frame(minWidth: 720)
                    VStack(spacing: DS.Space.space4) { accountCard; libraryCard; playbackCard }
                }
                Text(versionLine).dsCaption().frame(maxWidth: .infinity)
            }
            .padding(DS.Space.space6)
        }
        .background(DS.Color.ground)
        .navigationTitle("Settings")
        .task(id: auth.session?.email) { await loadUsage() }
    }

    private var versionLine: String {
        let info = Bundle.main
        let v = info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let b = info.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return "Electrophone \(v) (\(b))"
    }

    private func row<Trailing: View>(_ label: String, hint: String? = nil, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(alignment: .center, spacing: DS.Space.space3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(DS.Font.subhead).foregroundStyle(DS.Color.ink)
                if let hint { Text(hint).dsCaption().lineLimit(2).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: DS.Space.space2)
            trailing()
        }
        .frame(minHeight: 36)
    }

    private var divider: some View { Rectangle().fill(DS.Color.line).frame(height: 1) }

    private var accountCard: some View {
        LibCard(title: "Account") {
            if let session = auth.session {
                HStack(spacing: DS.Space.space3) {
                    Circle().fill(auth.expired || server.forbidden ? DS.Color.power : server.reachable == true ? DS.Color.ok : DS.Color.inkFaint)
                        .frame(width: 10, height: 10)
                    VStack(alignment: .leading, spacing: 2) {
                        (Text("Signed in as ") + Text(session.email ?? "your account").bold()).font(DS.Font.body).foregroundStyle(DS.Color.ink)
                        Text(accountStatus(session)).dsCaption()
                    }
                    Spacer(minLength: 0)
                }
                HStack {
                    if auth.expired { Button("Sign in again") { nav.showSignIn = true }.buttonStyle(LibLitButtonStyle()) }
                    Button("Sign out") { auth.signOut(); server.clearForbidden(); player.pause() }.buttonStyle(LibOutlineButtonStyle(danger: true))
                }
            } else {
                Text("Sign in to see your library, add songs and play them.").font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted)
                Button("Sign in") { nav.showSignIn = true }.buttonStyle(LibLitButtonStyle())
            }
            if let e = auth.error {
                Label(e, systemImage: "exclamationmark.circle.fill").font(T.caption).foregroundStyle(DS.Color.powerText)
            }
        }
    }

    private func accountStatus(_ session: AuthService.Session) -> String {
        if auth.expired { return "Expired, sign in again" }
        if server.forbidden { return "Not allowed on this server" }
        return "via \(session.provider == .apple ? "Apple" : "Google")"
    }

    private var musicTime: String {
        let total = library.songs.reduce(0.0) { $0 + ($1.duration ?? 0) }
        guard total > 0 else { return "" }
        let minutes = Int((total / 60).rounded())
        return minutes >= 60 ? String(format: "%.1f h of music", Double(minutes) / 60) : "\(minutes) min of music"
    }

    private var host: String {
        URL(string: settings.serverURL)?.host(percentEncoded: false) ?? settings.serverURL
    }

    private var serverStatus: String {
        if server.forbidden { return "Not allowed on this server" }
        switch server.reachable {
        case true?: return "Server online \u{00B7} \(host)"
        case false?: return "Server unavailable"
        case nil: return "Not checked yet"
        }
    }

    private var storageText: String {
        if usageFailed { return "Unavailable" }
        guard let u = usage else { return ServerLink.hasCredentials(settings) ? "Loading..." : "Sign in to see it" }
        let used = ByteCountFormatter.string(fromByteCount: u.bytes, countStyle: .file)
        if let maxSongs = u.max_songs, let maxBytes = u.max_bytes {
            return "\(u.songs) / \(maxSongs) songs \u{00B7} \(used) / \(ByteCountFormatter.string(fromByteCount: maxBytes, countStyle: .file))"
        }
        return "\(u.songs) \(u.songs == 1 ? "song" : "songs") \u{00B7} \(used)"
    }

    private var libraryCard: some View {
        LibCard(title: "Library") {
            HStack(alignment: .firstTextBaseline) {
                Text("\(library.songs.count) \(library.songs.count == 1 ? "song" : "songs")").font(DS.Font.title).foregroundStyle(DS.Color.ink)
                Spacer()
                Text(musicTime).dsCaption()
            }
            divider
            row("Storage") { Text(storageText).font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted) }
            divider
            row("Server") {
                HStack(spacing: DS.Space.space2) {
                    Circle().fill(server.reachable == true ? DS.Color.ok : server.reachable == false ? DS.Color.power : DS.Color.inkFaint)
                        .frame(width: 8, height: 8)
                    Text(serverStatus).font(DS.Font.subhead).foregroundStyle(DS.Color.inkMuted)
                    if server.checking { ProgressView().controlSize(.small) }
                    else { Button("Check") { Task { await server.check(settings: settings); await loadUsage() } }.buttonStyle(.link) }
                }
            }
            if settings.hasCustomConnection {
                divider
                row("Custom server: \(settings.customServerLabel)") {
                    Button("Reset") { settings.resetConnection(); Task { await server.check(settings: settings) } }.buttonStyle(.link)
                }
            }
        }
    }

    private var playbackCard: some View {
        LibCard(title: "Playback") {
            row("Auto-download songs", hint: "Download songs you play or add to the playlist. Each download counts toward the hourly add limit.") {
                Toggle("Auto-download songs", isOn: $ui.autoDownload).labelsHidden().toggleStyle(.switch).tint(DS.Color.accentStrong)
            }
        }
    }

    private func loadUsage() async {
        usage = nil; usageFailed = false
        guard ServerLink.hasCredentials(settings), !auth.expired else { return }
        do { usage = try await MacAPI(baseURL: settings.serverURL, token: settings.token).usage() }
        catch { usageFailed = true }
    }
}
