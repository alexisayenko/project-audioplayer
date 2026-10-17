import AuthenticationServices
import SwiftUI

struct MacSignInSheet: View {
    @EnvironmentObject var auth: AuthService
    @EnvironmentObject var nav: MacNavigation
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(auth.isSignedIn ? "Account" : "Sign in").font(.title2.bold())
            if let session = auth.session {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.email ?? "Signed in")
                    Text(auth.expired ? "Expired, sign in again" : "via \(session.provider == .apple ? "Apple" : "Google")")
                        .font(.footnote).foregroundStyle(DS.Color.inkMuted)
                }
                Button("Sign out", role: .destructive) { auth.signOut() }
            }
            if !auth.isSignedIn || auth.expired {
                Text("Sign in to see your library and stream it from your server. The Mac does not keep audio files yet.")
                    .font(.footnote).foregroundStyle(DS.Color.inkMuted)
                SignInWithAppleButton(.signIn) { $0.requestedScopes = [.email] } onCompletion: { auth.apple($0) }
                    .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
                    .id(scheme)
                    .frame(height: 36)
                Button { Task { await auth.signInWithGoogle() } } label: {
                    Text("Sign in with Google").frame(maxWidth: .infinity, minHeight: 28)
                }
                .disabled(auth.busy)
            }
            if let e = auth.error {
                Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(DS.Color.power)
            }
            HStack {
                Spacer()
                Button(auth.isSignedIn && !auth.expired ? "Done" : "Not now") { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 340)
        .onChange(of: auth.session?.email) { _, email in
            if email != nil, !auth.expired { dismiss() }
        }
    }
}
