import SwiftUI

/// The server's status LED, shown in the Add sheet and on Settings (never on Library).
struct ServerStatus: View {
    @EnvironmentObject var server: ServerLink
    @EnvironmentObject var settings: Settings
    var compact = false

    var body: some View {
        Button { Task { await server.check(settings: settings) } } label: {
            HStack(spacing: DS.Space.space2) {
                if server.checking { ProgressView().controlSize(.small) }
                else { LED(color: color, glow: server.reachable != nil) }
                Text(text).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.ink)
            }
            .frame(minHeight: compact ? 28 : DS.Space.hit, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text).accessibilityHint("Checks the server again")
    }

    private var color: Color {
        switch server.reachable { case true: DS.Color.ok; case false: DS.Color.power; default: DS.Color.inkFaint }
    }

    private var text: String {
        if server.forbidden { return "Not allowed on this server" }
        switch server.reachable { case true: return "Server online"; case false: return "Server unavailable"; default: return "Server not set up" }
    }
}

/// On a list page whose downloads need the server: said once while the server cannot be reached, with a Retry that asks it again.
struct OfflineDownloadNote: View {
    let retrying: Bool
    let retry: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.space2) {
            Image(systemName: "wifi.slash").font(.system(size: DS.Icon.iconInline)).foregroundStyle(DS.Color.inkMuted).accessibilityHidden(true)
            Text(retrying ? "Checking…" : "Offline. Downloads need the server.").font(T.caption).foregroundStyle(DS.Color.ink)
            Spacer(minLength: 0)
            Button("Retry", action: retry).font(T.caption.weight(.semibold)).foregroundStyle(DS.Color.accentInk)
                .frame(minWidth: DS.Space.hit, minHeight: DS.Space.hit).disabled(retrying)
        }.padding(.horizontal, DS.Space.space3).librarySlab(radius: DS.Radius.radiusKey)
    }
}

extension ServerLink {
    var ledColor: Color {
        switch reachable {
        case .some(true): return DS.Color.ok
        case .some(false): return DS.Color.power
        case .none: return DS.Color.inkFaint
        }
    }
}

/// Just the LED of the server's state, for a collapsed row.
struct ServerLED: View {
    @EnvironmentObject var server: ServerLink

    var body: some View {
        LED(color: server.ledColor, glow: server.reachable != nil)
    }
}
