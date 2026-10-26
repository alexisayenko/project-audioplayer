import Foundation

/// What the server learned about a link while staging it (`meta` of `GET /anon/downloads/{id}`).
struct AnonMeta: Codable, Equatable {
    var title: String?
    var artist: String?
    var duration: Double?
    var source_url: String?
    var platform: String?
    var year: Int?
    var video_id: String?
}

struct AnonJobStatus: Decodable, Equatable {
    var status: String
    var progress: Double?
    var error_code: String?
    var meta: AnonMeta?
    var size: Int64?
    var sha256: String?
    var expires_at: Date?

    private enum Keys: String, CodingKey { case status, progress, error_code, meta, size, sha256, expires_at }

    init(status: String, progress: Double? = nil, errorCode: String? = nil, meta: AnonMeta? = nil,
         size: Int64? = nil, sha256: String? = nil, expiresAt: Date? = nil) {
        self.status = status
        self.progress = progress
        self.error_code = errorCode
        self.meta = meta
        self.size = size
        self.sha256 = sha256
        self.expires_at = expiresAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        status = try c.decode(String.self, forKey: .status)
        progress = try? c.decode(Double.self, forKey: .progress)
        error_code = try? c.decode(String.self, forKey: .error_code)
        meta = try? c.decode(AnonMeta.self, forKey: .meta)
        size = try? c.decode(Int64.self, forKey: .size)
        sha256 = try? c.decode(String.self, forKey: .sha256)
        if let epoch = try? c.decode(Double.self, forKey: .expires_at) {
            expires_at = Date(timeIntervalSince1970: epoch)
        } else if let text = try? c.decode(String.self, forKey: .expires_at) {
            expires_at = Self.parse(text)
        }
    }

    private static func parse(_ text: String) -> Date? {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return plain.date(from: text) ?? fractional.date(from: text)
    }
}

/// Everything the account-free download needs from the server; the live one speaks HTTP, a test can fake it.
protocol AnonAPI: Sendable {
    func createJob(url: String) async throws -> String
    func status(_ id: String) async throws -> AnonJobStatus
    /// Appends to `partial` from its current size with a Range request, until `expectedSize` bytes are there.
    func downloadFile(_ id: String, to partial: URL, expectedSize: Int64?, onProgress: @escaping @Sendable (Double) -> Void) async throws
    func cover(_ id: String) async throws -> Data?
    func ack(_ id: String, sha256: String) async throws
}

enum AnonError: LocalizedError, Equatable {
    case refused(code: String, retryAfter: Int? = nil)
    case rateLimited(retryAfter: Int?)
    case busy
    case expired
    case unauthorized
    case network
    case mobileDataOff
    case damaged
    case incomplete
    case notReady
    case hashMismatch
    case http(Int, String)

    static let knownCodes: Set<String> = [
        "limit_hour", "limit_ip", "limit_concurrent", "too_long", "too_big", "unsupported_url", "disk_low", "extractor_failed",
        "not_found", "private", "preview_only", "anon_disabled", "busy", "not_configured",
    ]

    static func message(forCode code: String?, retryAfter: Int? = nil) -> String {
        switch code {
        case "limit_hour": return "You have reached the hourly limit for adding songs without an account. \(waitHint(retryAfter, or: "Try again later")), or sign in."
        case "limit_ip": return "Too many songs were added from this network just now. \(waitHint(retryAfter, or: "Try again in a while")), or sign in."
        case "too_long": return "This track is too long to add without an account."
        case "too_big": return "This track is too large to add without an account."
        case "unsupported_url": return "Unsupported link. Electrophone takes single YouTube and SoundCloud tracks only."
        case "disk_low": return "The server is short on space right now. Try again later."
        case "extractor_failed": return "The server could not fetch this track. Check the link and try again."
        case "limit_concurrent": return "A song is already being added. Wait for it to finish."
        case "not_found": return "Track not found. The link may be wrong or the track was removed."
        case "private": return "Private track. The server can't reach it."
        case "preview_only": return "This link is only a 30-second preview, so there is no full song to add."
        case "anon_disabled": return "Adding songs without an account is turned off on this server. Sign in to add songs."
        case "busy": return "The server is busy. Try again in a minute."
        case "not_configured": return "Adding songs without an account is not set up on this server. Sign in to add songs."
        default: return "The download failed. Try again."
        }
    }

    private static func waitHint(_ seconds: Int?, or fallback: String) -> String {
        guard let seconds, seconds > 0 else { return fallback }
        if seconds < 90 { return "Try again in a minute" }
        let minutes = Int((Double(seconds) / 60).rounded(.up))
        if minutes < 120 { return "Try again in \(minutes) minutes" }
        return "Try again in \(Int((Double(minutes) / 60).rounded(.up))) hours"
    }

    var errorDescription: String? {
        switch self {
        case .refused(let code, let after): return Self.message(forCode: code, retryAfter: after)
        case .rateLimited(let after): return "Too many requests. \(Self.waitHint(after, or: "Try again in a minute"))."
        case .busy: return "The server is busy. Try again in a minute."
        case .expired: return "This download expired on the server. Add the link again."
        case .unauthorized: return "The server did not accept this device. Try again."
        case .network: return "Can't reach the server. Check the connection and try again."
        case .mobileDataOff: return "Mobile data is off for downloads. Turn on Use mobile data in Settings."
        case .damaged: return "The file arrived damaged. Add the link again."
        case .incomplete: return "The download was cut short. It will resume."
        case .notReady: return "The server is still preparing this song."
        case .hashMismatch: return "The file arrived damaged. Add the link again."
        case .http(let code, let detail): return detail.isEmpty ? "The server answered with error \(code). Try again later." : detail
        }
    }

    /// A failure that keeps the job: it can succeed later without the person doing anything.
    var isTransient: Bool {
        switch self {
        case .rateLimited, .busy, .network, .mobileDataOff, .incomplete, .unauthorized, .notReady: return true
        case .http(let code, _): return code >= 500
        case .refused, .expired, .damaged, .hashMismatch: return false
        }
    }

    /// How long to wait before the next try when the server named a time.
    var retryAfter: Int? {
        switch self {
        case .rateLimited(let after): return after
        case .refused(_, let after): return after
        default: return nil
        }
    }
}

/// The per-device anonymous token: cached in the Keychain, renewed shortly before it expires, sent only to `/anon/` endpoints.
actor AnonSession {
    static let shared = AnonSession()

    private struct Stored: Codable {
        var token: String
        var expiresAt: Date
        var server: String
    }

    private static let keychainKey = "anon-session"
    private var cached: Stored?
    private var loaded = false

    /// `fetch` receives the token held now, so a renewal keeps the same device id while that token is still valid.
    func token(server: String, force: Bool = false, fetch: (String?) async throws -> (token: String, expiresIn: TimeInterval)) async throws -> String {
        if !loaded {
            loaded = true
            cached = Keychain.read(Self.keychainKey).flatMap { try? JSONDecoder().decode(Stored.self, from: $0) }
        }
        if !force, let c = cached, c.server == server, c.expiresAt.timeIntervalSinceNow > 60 { return c.token }
        let fresh = try await fetch(cached?.server == server ? cached?.token : nil)
        let stored = Stored(token: fresh.token, expiresAt: Date().addingTimeInterval(fresh.expiresIn), server: server)
        cached = stored
        if let data = try? JSONEncoder().encode(stored) { Keychain.write(Self.keychainKey, data) }
        return stored.token
    }

    func forget() {
        cached = nil
        Keychain.delete(Self.keychainKey)
    }
}

/// HTTP implementation of `AnonAPI` against `/anon/*`. `X-Anon-Token` is added here and nowhere else.
struct LiveAnonAPI: AnonAPI {
    let baseURL: String
    var session: AnonSession = .shared

    private static let jobID = try? NSRegularExpression(pattern: "^[A-Za-z0-9._-]{1,128}$")

    private func url(_ path: String) throws -> URL {
        guard path.hasPrefix(Endpoints.anonPrefix), var c = URLComponents(string: baseURL) else { throw APIError.badURL }
        c.path = path
        c.queryItems = nil
        guard let u = c.url else { throw APIError.badURL }
        return u
    }

    private func checked(_ id: String) throws -> String {
        let range = NSRange(id.startIndex..., in: id)
        guard id != ".", id != "..", Self.jobID?.firstMatch(in: id, range: range) != nil else { throw AnonError.expired }
        return id
    }

    private func newToken(renewing current: String?) async throws -> (token: String, expiresIn: TimeInterval) {
        var req = URLRequest(url: try url(Endpoints.anonSession))
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        if let current { req.setValue(current, forHTTPHeaderField: "X-Anon-Token") }
        let (data, response) = try await transport(req)
        try Self.check(response, data: data)
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let token = obj["token"] as? String, !token.isEmpty else {
            throw AnonError.http(0, "The server's reply could not be read. Update the app and try again.")
        }
        let ttl = (obj["expires_in"] as? Double) ?? 3600
        return (token, ttl)
    }

    private func authorized(_ base: URLRequest, force: Bool) async throws -> URLRequest {
        var req = base
        let token = try await session.token(server: baseURL, force: force, fetch: newToken)
        req.setValue(token, forHTTPHeaderField: "X-Anon-Token")
        return req
    }

    private func transport(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else { throw AnonError.network }
            return (data, http)
        } catch let e as URLError where e.code != .cancelled {
            throw AnonError.network
        }
    }

    /// Sends an authorized request; a 401 renews the token once and repeats.
    private func send(_ path: String, method: String, body: [String: Any]? = nil, timeout: TimeInterval = 30) async throws -> Data {
        var req = URLRequest(url: try url(path))
        req.httpMethod = method
        req.timeoutInterval = timeout
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        for attempt in 0..<2 {
            let (data, response) = try await transport(try await authorized(req, force: attempt > 0))
            if response.statusCode == 401, attempt == 0 { continue }
            try Self.check(response, data: data)
            return data
        }
        throw AnonError.unauthorized
    }

    static func check(_ response: HTTPURLResponse, data: Data?) throws {
        guard !(200..<300).contains(response.statusCode) else { return }
        throw error(status: response.statusCode, data: data, retryAfter: response.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0) })
    }

    static func error(status: Int, data: Data?, retryAfter: Int?) -> AnonError {
        var code: String?
        var text = ""
        var retryHint: Int?
        if let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            func pick(_ o: [String: Any]) -> String? { (o["error_code"] as? String) ?? (o["error"] as? String) ?? (o["code"] as? String) }
            code = pick(obj)
            retryHint = (obj["retry_after"] as? Int)
            if let detail = obj["detail"] as? [String: Any] { code = code ?? pick(detail) }
            if let detail = obj["detail"] as? String {
                if code == nil, knownCodes.contains(detail) { code = detail }
                text = detail
            }
        }
        let after = retryAfter ?? retryHint
        if status == 404 || status == 410 { return .expired }
        if status == 409, code == "not_ready" { return .notReady }
        if status == 422, code == "hash_mismatch" || code == "bad_hash" { return .hashMismatch }
        if status == 401 { return .unauthorized }
        if let code, knownCodes.contains(code) {
            if code == "busy" { return .busy }
            return .refused(code: code, retryAfter: after)
        }
        switch status {
        case 409: return .incomplete
        case 429: return .rateLimited(retryAfter: after)
        case 503: return .busy
        default: return .http(status, knownCodes.contains(text) ? "" : text)
        }
    }

    private static var knownCodes: Set<String> { AnonError.knownCodes }

    func createJob(url link: String) async throws -> String {
        let data = try await send(Endpoints.anonDownloads, method: "POST", body: ["url": link])
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = obj["id"] as? String, !id.isEmpty else {
            throw AnonError.http(0, "The server's reply could not be read. Update the app and try again.")
        }
        return try checked(id)
    }

    func status(_ id: String) async throws -> AnonJobStatus {
        let data = try await send(Endpoints.anonDownload(try checked(id)), method: "GET", timeout: 15)
        do { return try JSONDecoder().decode(AnonJobStatus.self, from: data) }
        catch { throw AnonError.http(0, "The server's reply could not be read. Update the app and try again.") }
    }

    func cover(_ id: String) async throws -> Data? {
        do { return try await send(Endpoints.anonCover(try checked(id)), method: "GET", timeout: 20) }
        catch AnonError.expired { return nil }
    }

    func ack(_ id: String, sha256: String) async throws {
        _ = try await send(Endpoints.anonAck(try checked(id)), method: "POST", body: ["sha256": sha256], timeout: 20)
    }

    func downloadFile(_ id: String, to partial: URL, expectedSize: Int64?, onProgress: @escaping @Sendable (Double) -> Void) async throws {
        let path = Endpoints.anonFile(try checked(id))
        let etagFile = partial.appendingPathExtension("etag")
        let fm = FileManager.default
        for attempt in 0..<3 {
            var offset = (try? fm.attributesOfItem(atPath: partial.path)[.size] as? Int64) ?? 0
            if let expectedSize, offset > expectedSize { try? fm.removeItem(at: partial); offset = 0 }
            if let expectedSize, offset == expectedSize { onProgress(1); return }
            var req = URLRequest(url: try url(path))
            req.timeoutInterval = 60
            if offset > 0 {
                req.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
                if let etag = try? String(contentsOf: etagFile, encoding: .utf8), !etag.isEmpty { req.setValue(etag, forHTTPHeaderField: "If-Range") }
            }
            req = try await authorized(req, force: attempt > 0)
            let fetcher = RangeFetcher(partial: partial, offset: offset, total: expectedSize, onProgress: onProgress)
            let urlSession = APIClient.downloadSession(delegate: fetcher)
            defer { urlSession.finishTasksAndInvalidate() }
            let result: (HTTPURLResponse, Data)
            do {
                result = try await fetcher.run(urlSession, req)
            } catch let e as URLError where e.code == .dataNotAllowed || e.code == .internationalRoamingOff {
                throw AnonError.mobileDataOff
            } catch let e as URLError where e.code != .cancelled {
                throw AnonError.network
            }
            let (http, body) = result
            switch http.statusCode {
            case 200, 206:
                if let etag = http.value(forHTTPHeaderField: "ETag") { try? etag.write(to: etagFile, atomically: true, encoding: .utf8) }
                let size = (try? fm.attributesOfItem(atPath: partial.path)[.size] as? Int64) ?? 0
                if let expectedSize, size < expectedSize { throw AnonError.incomplete }
                if let expectedSize, size > expectedSize { try? fm.removeItem(at: partial); throw AnonError.incomplete }
                onProgress(1)
                return
            case 401 where attempt == 0:
                continue
            case 416:
                try? fm.removeItem(at: partial)
                try? fm.removeItem(at: etagFile)
                continue
            default:
                throw Self.error(status: http.statusCode, data: body, retryAfter: http.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0) })
            }
        }
        throw AnonError.incomplete
    }
}

/// Streams one (possibly ranged) response into `partial`: a 206 appends, a 200 starts the file over, anything else is returned with its body.
private final class RangeFetcher: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let partial: URL
    private var offset: Int64
    private var total: Int64?
    private let onProgress: @Sendable (Double) -> Void
    private var handle: FileHandle?
    private var response: HTTPURLResponse?
    private var body = Data()
    private var writeError: Error?
    private var continuation: CheckedContinuation<(HTTPURLResponse, Data), Error>?

    init(partial: URL, offset: Int64, total: Int64?, onProgress: @escaping @Sendable (Double) -> Void) {
        self.partial = partial; self.offset = offset; self.total = total; self.onProgress = onProgress
    }

    func run(_ session: URLSession, _ request: URLRequest) async throws -> (HTTPURLResponse, Data) {
        try await withCheckedThrowingContinuation { cont in
            continuation = cont
            session.dataTask(with: request).resume()
        }
    }

    func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
        self.response = http
        guard http.statusCode == 200 || http.statusCode == 206 else { completionHandler(.allow); return }
        do {
            let fm = FileManager.default
            try fm.createDirectory(at: partial.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !fm.fileExists(atPath: partial.path) { fm.createFile(atPath: partial.path, contents: nil) }
            let h = try FileHandle(forWritingTo: partial)
            if http.statusCode == 200 { offset = 0 }
            try h.truncate(atOffset: UInt64(offset))
            try h.seekToEnd()
            handle = h
            if total == nil, http.expectedContentLength > 0 { total = offset + http.expectedContentLength }
            completionHandler(.allow)
        } catch {
            writeError = error
            completionHandler(.cancel)
        }
    }

    func urlSession(_: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let handle else { body.append(data); return }
        do {
            try handle.write(contentsOf: data)
            offset += Int64(data.count)
            if let total, total > 0 { onProgress(min(1, Double(offset) / Double(total))) }
        } catch {
            writeError = error
            dataTask.cancel()
        }
    }

    func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
        try? handle?.close()
        handle = nil
        let cont = continuation
        continuation = nil
        if let writeError { cont?.resume(throwing: writeError) }
        else if let error { cont?.resume(throwing: error) }
        else if let response { cont?.resume(returning: (response, body)) }
        else { cont?.resume(throwing: URLError(.unknown)) }
    }
}
