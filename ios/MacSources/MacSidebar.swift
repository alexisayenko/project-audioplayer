import SwiftUI

struct MacSidebar: View {
    @EnvironmentObject var nav: MacNavigation
    @EnvironmentObject var auth: AuthService
    @EnvironmentObject var server: ServerLink

    var body: some View {
        List(MacPage.allCases, selection: $nav.page) { page in
            Label(page.title, systemImage: page.symbol).tag(page)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { account }
    }

    private var account: some View {
        Button { nav.showSignIn = true } label: {
            HStack(spacing: 8) {
                Circle().fill(ledColor).frame(width: 8, height: 8)
                Text(auth.session?.email ?? "Sign in").font(.footnote).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(auth.isSignedIn ? "Account" : "Sign in with Apple or Google")
    }

    private var ledColor: Color {
        if auth.expired || server.forbidden { return DS.Color.power }
        switch server.reachable {
        case true?: return DS.Color.ok
        case false?: return DS.Color.power
        case nil: return DS.Color.inkFaint
        }
    }
}
