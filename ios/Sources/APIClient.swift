import Foundation

enum APIError: LocalizedError {
    case badURL
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Invalid server URL"
        case .http(let code, let detail): return "Server error \(code): \(detail)"
        }
    }
}

/// Talks to the `server/` FastAPI service.
struct APIClient {
    let baseURL: String
    let token: String

    private func request(_ path: String, query: [URLQueryItem] = [], method: String = "GET",
                         body: Data? = nil) throws -> URLRequest {
        guard var comps = URLComponents(string: baseURL) else { throw APIError.badURL }
        comps.path = path
        comps.queryItems = query.isEmpty ? nil : query
        guard let url = comps.url else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue(token, forHTTPHeaderField: "X-API-Token")
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
            let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            throw APIError.http(http.statusCode, detail)
        }
    }

    func health() async throws {
        let (data, response) = try await URLSession.shared.data(for: request("/health"))
        try check(response, data: data)
    }

    func search(_ query: String) async throws -> [SearchResult] {
        let req = try request("/search", query: [.init(name: "q", value: query)])
        let (data, response) = try await URLSession.shared.data(for: req)
        try check(response, data: data)
        return try JSONDecoder().decode([SearchResult].self, from: data)
    }

    /// Asks the server to fetch the audio, then copies the file into the app.
    func download(_ result: SearchResult) async throws -> Track {
        struct Body: Encodable { let video_id: String }
        let post = try request("/download", method: "POST", body: JSONEncoder().encode(Body(video_id: result.id)))
        let (data, response) = try await URLSession.shared.data(for: post)
        try check(response, data: data)
        let track = try JSONDecoder().decode(Track.self, from: data)

        let (tmp, fileResponse) = try await URLSession.shared.download(for: request("/files/\(track.id)"))
        try check(fileResponse)
        let dest = track.fileURL
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return track
    }
}
