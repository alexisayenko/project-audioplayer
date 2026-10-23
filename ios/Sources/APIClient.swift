import Foundation

enum APIError: LocalizedError {
    case badURL
    case http(Int, String)
    case refused(String, String)
    case unreachable
    case forbidden

    static let forbiddenMessage = "This account isn't allowed on this server. Sign out and use another account."
    static let forbiddenCodes: Set<String> = ["forbidden", "not_allowed", "signup_closed", "unverified_email", "no_email"]

    var errorDescription: String? {
        switch self {
        case .badURL: return "Invalid server URL"
        case .unreachable: return "Can't reach the server"
        case .forbidden: return Self.forbiddenMessage
        case .refused(_, let detail): return detail
        case .http(let code, let detail):
            if code == 401 { return "Not signed in. Sign in in Settings" }
            return detail.isEmpty ? "Server error \(code)" : detail
        }
    }
}

/// Talks to the `server/` FastAPI service.
struct APIClient {
    let baseURL: String
    let token: String

    private func request(_ path: String, query: [URLQueryItem] = [], method: String = "GET",
                         body: Data? = nil) async throws -> URLRequest {
        guard var comps = URLComponents(string: baseURL) else { throw APIError.badURL }
        comps.path = path
        comps.queryItems = query.isEmpty ? nil : query
        guard let url = comps.url else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let bearer = await AuthService.shared.validToken() {
            req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        } else if !token.isEmpty {
            req.setValue(token, forHTTPHeaderField: "X-API-Token")
        }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        // Downloads can take a while on the server.
        req.timeoutInterval = 300
        return req
    }

    private func check(_ response: URLResponse, data: Data? = nil) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            var detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            if let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if http.statusCode == 403, let code = obj["error"] as? String, APIError.forbiddenCodes.contains(code) { throw APIError.forbidden }
                if let code = obj["error"] as? String, let d = obj["detail"] as? String { throw APIError.refused(code, d) }
                if let d = obj["detail"] as? String { detail = d }
                else if let e = obj["error"] as? String { detail = e }
                else if let list = obj["detail"] as? [[String: Any]] {
                    detail = list.compactMap { $0["msg"] as? String }.joined(separator: "; ")
                }
            }
            throw APIError.http(http.statusCode, detail)
        }
    }

    /// File downloads honour Settings > Use mobile data; the small API calls always go through.
    static func downloadSession(delegate: URLSessionDelegate? = nil) -> URLSession {
        let cellular = UserDefaults.standard.bool(forKey: Settings.useMobileDataKey)
        let c = URLSessionConfiguration.default
        c.allowsCellularAccess = cellular
        c.allowsExpensiveNetworkAccess = cellular
        c.allowsConstrainedNetworkAccess = cellular
        return URLSession(configuration: c, delegate: delegate, delegateQueue: nil)
    }

    func verify() async throws {
        let (data, response) = try await URLSession.shared.data(for: try await request(Endpoints.tags))
        try check(response, data: data)
    }

    func fetch(_ path: String) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: try await request(path))
        try check(response, data: data)
        return data
    }

    /// Sends one play batch (API-196) and returns the HTTP status, so the caller can tell a refusal that drops the batch from one worth retrying.
    func postPlays(_ body: Data) async throws -> Int {
        var req = try await request(Endpoints.plays, method: "POST", body: body)
        req.timeoutInterval = 30
        let (_, response) = try await URLSession.shared.data(for: req)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }

    /// The whole catalog, or nil when the server answers 304 to the stored ETag.
    func catalog(etag: String?) async throws -> (catalog: CatalogResponse, etag: String?)? {
        var req = try await request(Endpoints.catalog)
        req.timeoutInterval = 20
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let etag { req.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await URLSession.shared.data(for: req)
        if (response as? HTTPURLResponse)?.statusCode == 304 { return nil }
        try check(response, data: data)
        let tag = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag")
        return (try JSONDecoder().decode(CatalogResponse.self, from: data), tag)
    }

    /// Asks the server to fetch a catalog song's audio from its stored link; progress is then read from the song status.
    func fetchAudio(_ id: String) async throws {
        var req = try await request(Endpoints.songAudio(id), method: "POST")
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        try check(response, data: data)
    }

    func genres() async throws -> [String] {
        var req = try await request(Endpoints.genres)
        req.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: req)
        try check(response, data: data)
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let list = obj["genres"] as? [Any] else { return [] }
        return list.compactMap { $0 as? String }
    }

    func search(_ query: String) async throws -> [SearchResult] {
        var req = try await request(Endpoints.search, query: [.init(name: "q", value: query)])
        req.timeoutInterval = 30
        let data: Data
        let response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: req) }
        catch let e as URLError where e.code != .cancelled { throw APIError.unreachable }
        try check(response, data: data)
        return try JSONDecoder().decode([SearchResult].self, from: data)
    }

    /// Copies an audio file that is already on the server into the app, reporting 0...1 as it arrives.
    func downloadFile(_ track: Track, onProgress: (@Sendable (Double) -> Void)? = nil) async throws {
        let fetcher = FileFetcher(onProgress)
        let session = Self.downloadSession(delegate: fetcher)
        defer { session.finishTasksAndInvalidate() }
        let tmp: URL
        let response: URLResponse
        do {
            (tmp, response) = try await fetcher.run(session, try await request(Endpoints.file(track.id)))
        } catch let e as URLError where e.code == .dataNotAllowed || e.code == .internationalRoamingOff {
            throw APIError.http(0, "Mobile data is off for downloads. Turn on Use mobile data in Settings.")
        }
        try check(response)
        let dest = AudioFiles.reserve(track)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
    }

    /// Asks the server to fetch the audio, then copies the file into the app.
    func download(_ result: SearchResult) async throws -> Track {
        struct Body: Encodable {
            let videoID: String
            enum CodingKeys: String, CodingKey { case videoID = "video_id" }
        }
        let post = try await request(Endpoints.download, method: "POST", body: JSONEncoder().encode(Body(videoID: result.id)))
        let (data, response) = try await URLSession.shared.data(for: post)
        try check(response, data: data)
        let track = try JSONDecoder().decode(Track.self, from: data)

        let session = Self.downloadSession()
        defer { session.finishTasksAndInvalidate() }
        let (tmp, fileResponse) = try await session.download(for: try await request(Endpoints.file(track.id)))
        try check(fileResponse)
        let dest = AudioFiles.reserve(track)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return track
    }

    // MARK: Add and edit

    private func send(_ path: String, method: String, body: [String: Any]? = nil,
                      timeout: TimeInterval = 30) async throws -> Data {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        var req = try await request(path, method: method, body: data)
        req.timeoutInterval = timeout
        do {
            let (out, response) = try await URLSession.shared.data(for: req)
            try check(response, data: out)
            return out
        } catch let e as URLError {
            if e.code == .cancelled { throw e }
            throw e.code == .timedOut ? APIError.http(0, "Server timed out") : APIError.unreachable
        }
    }

    func preview(url: String) async throws -> Preview {
        try JSONDecoder().decode(Preview.self, from: await send(Endpoints.preview, method: "POST", body: ["url": url], timeout: 90))
    }

    func addSong(url: String, metadata: [String: Any], tags: [String], audio: Bool = true) async throws {
        _ = try await send(Endpoints.songs, method: "POST", body: ["url": url, "metadata": metadata, "tags": tags, "audio": audio])
    }

    func status(_ id: String) async throws -> SongStatus {
        try JSONDecoder().decode(SongStatus.self, from: await send(Endpoints.songStatus(id), method: "GET", timeout: 15))
    }

    func patch(_ id: String, changes: [String: Any]) async throws -> ServerSong {
        try JSONDecoder().decode(ServerSong.self, from: await send(Endpoints.song(id), method: "PATCH", body: changes))
    }

    func detectBpm(_ id: String) async throws -> ServerSong {
        try JSONDecoder().decode(ServerSong.self, from: await send(Endpoints.songBPMDetect(id), method: "POST", timeout: 120))
    }

    func metadata(title: String, artist: String, sourceURLs: [String], wikiSong: String, wikiArtist: String) async throws -> MetadataResult {
        let body: [String: Any] = ["title": title, "artist": artist, "sources": sourceURLs.map { ["url": $0] },
                                  "wiki_song": wikiSong.isEmpty ? NSNull() : wikiSong,
                                  "wiki_artist": wikiArtist.isEmpty ? NSNull() : wikiArtist]
        return try JSONDecoder().decode(MetadataResult.self, from: await send(Endpoints.metadata, method: "POST", body: body, timeout: 60))
    }

    func delete(_ id: String) async throws {
        _ = try await send(Endpoints.song(id), method: "DELETE")
    }
}

/// Runs one download task and reports 0...1 as bytes arrive; hands back a temp copy the caller owns.
private final class FileFetcher: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let onProgress: (@Sendable (Double) -> Void)?
    private var continuation: CheckedContinuation<(URL, URLResponse), Error>?
    private var result: URL?

    init(_ onProgress: (@Sendable (Double) -> Void)?) { self.onProgress = onProgress }

    func run(_ session: URLSession, _ request: URLRequest) async throws -> (URL, URLResponse) {
        try await withCheckedThrowingContinuation { cont in
            continuation = cont
            session.downloadTask(with: request).resume()
        }
    }

    func urlSession(_: URLSession, downloadTask _: URLSessionDownloadTask, didWriteData _: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        onProgress?(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_: URLSession, downloadTask _: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let keep = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.moveItem(at: location, to: keep)
        result = keep
    }

    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { continuation = nil }
        if let error { continuation?.resume(throwing: error) }
        else if let result, let response = task.response { continuation?.resume(returning: (result, response)) }
        else { continuation?.resume(throwing: URLError(.unknown)) }
    }
}
