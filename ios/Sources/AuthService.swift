import AuthenticationServices
import CryptoKit
import SwiftUI

/// Owner-only OAuth sign-in. Songs already on the phone never depend on this: it only produces
/// the `Authorization: Bearer <ID token>` header for server calls.
@MainActor
final class AuthService: NSObject, ObservableObject {
    static let shared = AuthService()

    enum Provider: String, Codable { case apple, google }

    struct Session: Codable {
        var provider: Provider
        var email: String?
        var idToken: String
        var expiry: Date
        var refreshToken: String?
    }

    @Published private(set) var session: Session?
    @Published var error: String?
    @Published private(set) var busy = false

    private static let keychainKey = "session"
    private var webSession: ASWebAuthenticationSession?

    var isSignedIn: Bool { session != nil }
    var expired: Bool { session.map { $0.expiry <= Date() } ?? false }

    private override init() {
        super.init()
        if let data = Keychain.read(Self.keychainKey) {
            session = try? JSONDecoder().decode(Session.self, from: data)
        }
    }

    private func store(_ s: Session?) {
        session = s
        if let s, let data = try? JSONEncoder().encode(s) { Keychain.write(Self.keychainKey, data) }
        else { Keychain.delete(Self.keychainKey) }
    }

    func signOut() {
        store(nil)
        error = nil
    }

    /// A bearer token that is valid for at least a minute, refreshed silently when possible.
    /// Returns nil when signed out, offline, or an Apple token has expired (the API token is the fallback).
    func validToken() async -> String? {
        guard let s = session else { return nil }
        if s.expiry.timeIntervalSinceNow > 60 { return s.idToken }
        if s.provider == .google, let refresh = s.refreshToken, await refreshGoogle(refresh) {
            return session?.idToken
        }
        return s.expiry > Date() ? s.idToken : nil
    }

    /// Forces a refresh when the provider supports it, then falls back to `validToken()`.
    func refreshedToken() async -> String? {
        if let s = session, s.provider == .google, let refresh = s.refreshToken, await refreshGoogle(refresh) {
            return session?.idToken
        }
        return await validToken()
    }

    // MARK: Apple

    func apple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let e):
            if (e as? ASAuthorizationError)?.code != .canceled { error = e.localizedDescription }
        case .success(let auth):
            guard let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                  let data = cred.identityToken, let jwt = String(data: data, encoding: .utf8),
                  let claims = Self.claims(jwt) else { error = "Apple returned no ID token"; return }
            store(Session(provider: .apple, email: claims.email ?? cred.email, idToken: jwt,
                          expiry: claims.expiry, refreshToken: nil))
            error = nil
            Task { await confirmAppleSession() }
        }
    }

    /// The server is the judge of an Apple token: a 401 means it rejected the audience, issuer or signature, so the local session is dropped instead of pretending to be signed in.
    private func confirmAppleSession() async {
        let base = UserDefaults.standard.string(forKey: "serverURL") ?? Endpoints.defaultServer
        busy = true
        defer { busy = false }
        do {
            try await APIClient(baseURL: base, token: "").verify()
        } catch APIError.http(401, _) {
            guard session?.provider == .apple else { return }
            signOut()
            error = "Sign in failed: the server did not accept the Apple token"
        } catch {}
    }

    // MARK: Google (authorization code + PKCE, no SDK)

    private var googleClientID: String { Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String ?? "" }
    private var googleRedirectScheme: String { googleClientID.split(separator: ".").reversed().joined(separator: ".") }
    private var googleRedirect: String { "\(googleRedirectScheme):/oauth2redirect" }

    func signInWithGoogle() async {
        guard !googleClientID.isEmpty, !googleClientID.hasPrefix("REPLACE_ME") else {
            error = "Google client ID is not configured (ios/Config/Secrets.xcconfig)"
            return
        }
        busy = true
        defer { busy = false }
        let verifier = Self.randomString()
        let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomString()
        var c = URLComponents(string: Endpoints.googleAuth)!
        c.queryItems = [
            .init(name: "client_id", value: googleClientID), .init(name: "redirect_uri", value: googleRedirect),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid email"),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
        ]
        do {
            let callback: URL = try await withCheckedThrowingContinuation { cont in
                let web = ASWebAuthenticationSession(url: c.url!, callbackURLScheme: googleRedirectScheme) { url, err in
                    if let url { cont.resume(returning: url) } else { cont.resume(throwing: err ?? URLError(.cancelled)) }
                }
                web.presentationContextProvider = self
                webSession = web
                web.start()
            }
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard items.first(where: { $0.name == "state" })?.value == state,
                  let code = items.first(where: { $0.name == "code" })?.value else { error = "Google sign-in failed"; return }
            try await exchangeGoogle(["grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                                      "client_id": googleClientID, "redirect_uri": googleRedirect])
            error = nil
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        webSession = nil
    }

    private func refreshGoogle(_ refresh: String) async -> Bool {
        do {
            try await exchangeGoogle(["grant_type": "refresh_token", "refresh_token": refresh,
                                      "client_id": googleClientID], keepRefresh: refresh)
            return true
        } catch { return false }
    }

    private func exchangeGoogle(_ form: [String: String], keepRefresh: String? = nil) async throws {
        var req = URLRequest(url: URL(string: Endpoints.googleToken)!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        req.httpBody = form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        req.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let jwt = obj["id_token"] as? String, let claims = Self.claims(jwt) else {
            throw NSError(domain: "AuthService", code: 1, userInfo: [NSLocalizedDescriptionKey: "Google sign-in was rejected"])
        }
        store(Session(provider: .google, email: claims.email, idToken: jwt, expiry: claims.expiry,
                      refreshToken: (obj["refresh_token"] as? String) ?? keepRefresh))
    }

    // MARK: Helpers

    private static func claims(_ jwt: String) -> (email: String?, expiry: Date)? {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = obj["exp"] as? Double else { return nil }
        return (obj["email"] as? String, Date(timeIntervalSince1970: exp))
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    private static func randomString() -> String {
        base64url(Data((0..<32).map { _ in UInt8.random(in: 0...255) }))
    }
}

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(iOS)
        return UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        #else
        return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #endif
    }
}
