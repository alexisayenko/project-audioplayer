import Foundation

enum APIError: LocalizedError {
    case badURL
    case http(Int, String)
    case refused(String, String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Invalid server URL"
        case .refused(_, let detail): return detail
        case .http(let code, let detail):
            if code == 401 { return "Not signed in or wrong API token (see Settings)" }
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
                if let code = obj["error"] as? String, let d = obj["detail"] as? String { throw APIError.refused(code, d) }
                if let d = obj["detail"] as? String { detail = d }
                else if let list = obj["detail"] as? [[String: Any]] {
                    detail = list.compactMap { $0["msg"] as? String }.joined(separator: "; ")
                }
            }
            throw APIError.http(http.statusCode, detail)
        }
    }

    /// File downloads honour Settings > Use mobile data; the small API calls always go through.
    private static func downloadSession() -> URLSession {
        let cellular = UserDefaults.standard.bool(forKey: Settings.useMobileDataKey)
        let c = URLSessionConfiguration.default
        c.allowsCellularAccess = cellular
        c.allowsExpensiveNetworkAccess = cellular
        c.allowsConstrainedNetworkAccess = cellular
        return URLSession(configuration: c)
    }

    func verify() async throws {
        let (data, response) = try await URLSession.shared.data(for: try await request("/tags"))
        try check(response, data: data)
    }

    func fetch(_ path: String) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: try await request(path))
        try check(response, data: data)
        return data
    }

    func search(_ query: String) async throws -> [SearchResult] {
        let req = try await request("/search", query: [.init(name: "q", value: query)])
        let (data, response) = try await URLSession.shared.data(for: req)
        try check(response, data: data)
        return try JSONDecoder().decode([SearchResult].self, from: data)
    }

    /// Copies an audio file that is already on the server into the app, reporting 0...1 as it arrives.
    func downloadFile(_ track: Track, onProgress: @escaping @Sendable (Double) -> Void = { _ in }) async throws {
        let session = Self.downloadSession()
        defer { session.finishTasksAndInvalidate() }
        let tmp: URL, response: URLResponse
        do {
            (tmp, response) = try await session.download(for: try await request("/files/\(track.id)"),
                                                         delegate: ProgressDelegate(onProgress))
        } catch let e as URLError where e.code == .dataNotAllowed || e.code == .internationalRoamingOff {
            throw APIError.http(0, "Mobile data is off for downloads. Turn on Use mobile data in Settings.")
        }
        try check(response)
        try? FileManager.default.removeItem(at: track.fileURL)
        try FileManager.default.moveItem(at: tmp, to: track.fileURL)
    }

    /// Asks the server to fetch the audio, then copies the file into the app.
    func download(_ result: SearchResult) async throws -> Track {
        struct Body: Encodable { let video_id: String }
        let post = try await request("/download", method: "POST", body: JSONEncoder().encode(Body(video_id: result.id)))
        let (data, response) = try await URLSession.shared.data(for: post)
        try check(response, data: data)
        let track = try JSONDecoder().decode(Track.self, from: data)

        let session = Self.downloadSession()
        defer { session.finishTasksAndInvalidate() }
        let (tmp, fileResponse) = try await session.download(for: try await request("/files/\(track.id)"))
        try check(fileResponse)
        let dest = track.fileURL
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
            throw APIError.http(0, e.code == .timedOut ? "Server timed out" : "Server unreachable")
        }
    }

    func preview(url: String) async throws -> Preview {
        try JSONDecoder().decode(Preview.self, from: await send("/preview", method: "POST", body: ["url": url], timeout: 90))
    }

    func addSong(url: String, metadata: [String: Any], tags: [String]) async throws {
        _ = try await send("/songs", method: "POST", body: ["url": url, "metadata": metadata, "tags": tags])
    }

    func status(_ id: String) async throws -> SongStatus {
        try JSONDecoder().decode(SongStatus.self, from: await send("/songs/\(id)/status", method: "GET", timeout: 15))
    }

    func patch(_ id: String, changes: [String: Any]) async throws -> ServerSong {
        try JSONDecoder().decode(ServerSong.self, from: await send("/songs/\(id)", method: "PATCH", body: changes))
    }

    func detectBpm(_ id: String) async throws -> ServerSong {
        try JSONDecoder().decode(ServerSong.self, from: await send("/songs/\(id)/bpm/detect", method: "POST", timeout: 120))
    }

    func lookupWikipedia(song: String?, artist: String?) async throws -> WikiLookup {
        let body: [String: Any] = ["wikipedia_song": song.map { $0 as Any } ?? NSNull(),
                                  "wikipedia_artist": artist.map { $0 as Any } ?? NSNull()]
        return try JSONDecoder().decode(WikiLookup.self, from: await send("/lookup/wikipedia", method: "POST", body: body, timeout: 60))
    }

    func delete(_ id: String) async throws {
        _ = try await send("/songs/\(id)", method: "DELETE")
    }
}

private final class ProgressDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void
    init(_ onProgress: @escaping @Sendable (Double) -> Void) { self.onProgress = onProgress }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        onProgress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
}
