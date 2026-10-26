import Foundation

/// Calls the Mac pages need that the shared `APIClient` does not have: covers and the usage meter.
struct MacAPI {
    let baseURL: String
    let token: String

    struct Usage: Decodable {
        var songs: Int
        var max_songs: Int?
        var bytes: Int64
        var max_bytes: Int64?
    }

    private func request(_ path: String, method: String, contentType: String? = nil, body: Data? = nil) async throws -> URLRequest {
        guard var c = URLComponents(string: baseURL) else { throw APIError.badURL }
        c.path = path
        guard let url = c.url else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let bearer = await AuthService.shared.validToken() {
            req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        } else if !token.isEmpty {
            req.setValue(token, forHTTPHeaderField: "X-API-Token")
        }
        if let body {
            req.httpBody = body
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        req.timeoutInterval = 60
        return req
    }

    private func send(_ req: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: req) }
        catch let e as URLError where e.code != .cancelled { throw APIError.unreachable }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            var detail = ""
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { detail = obj["detail"] as? String ?? obj["error"] as? String ?? "" }
            throw APIError.http(http.statusCode, detail)
        }
        return data
    }

    func usage() async throws -> Usage {
        try JSONDecoder().decode(Usage.self, from: await send(request(Endpoints.meUsage, method: "GET")))
    }

    func uploadCover(_ id: String, data: Data, contentType: String) async throws -> ServerSong {
        let out = try await send(request(Endpoints.songCover(id), method: "PUT", contentType: contentType, body: data))
        return try JSONDecoder().decode(ServerSong.self, from: out)
    }

    func coverFromURL(_ id: String, url: String) async throws -> ServerSong {
        let body = try JSONSerialization.data(withJSONObject: ["url": url])
        let out = try await send(request(Endpoints.songCoverFromURL(id), method: "POST", contentType: "application/json", body: body))
        return try JSONDecoder().decode(ServerSong.self, from: out)
    }

    func removeCover(_ id: String) async throws {
        _ = try await send(request(Endpoints.songCover(id), method: "DELETE"))
    }
}
