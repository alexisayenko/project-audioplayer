import Foundation

/// Playlists (API-229 to API-236), albums (API-250) and usage (API-046).
extension APIClient {
    func playlists() async throws -> [PlaylistSummary] {
        try JSONDecoder().decode(PlaylistList.self, from: await send(Endpoints.playlists, method: "GET")).playlists
    }

    func playlist(_ id: String) async throws -> PlaylistDetail {
        try JSONDecoder().decode(PlaylistDetail.self, from: await send(Endpoints.playlist(id), method: "GET"))
    }

    func createPlaylist(name: String, songIDs: [String] = []) async throws -> PlaylistDetail {
        let body: [String: Any] = ["name": name, "song_ids": songIDs]
        return try JSONDecoder().decode(PlaylistDetail.self, from: await send(Endpoints.playlists, method: "POST", body: body))
    }

    func renamePlaylist(_ id: String, name: String) async throws -> PlaylistDetail {
        try JSONDecoder().decode(PlaylistDetail.self, from: await send(Endpoints.playlist(id), method: "PATCH", body: ["name": name]))
    }

    func deletePlaylist(_ id: String) async throws {
        _ = try await send(Endpoints.playlist(id), method: "DELETE")
    }

    func addToPlaylist(_ id: String, songIDs: [String]) async throws -> PlaylistAddResult {
        try JSONDecoder().decode(PlaylistAddResult.self, from: await send(Endpoints.playlistSongs(id), method: "POST", body: ["song_ids": songIDs]))
    }

    func removeFromPlaylist(_ id: String, songID: String) async throws {
        _ = try await send(Endpoints.playlistSong(id, songID), method: "DELETE")
    }

    func reorderPlaylist(_ id: String, songIDs: [String]) async throws -> PlaylistDetail {
        try JSONDecoder().decode(PlaylistDetail.self, from: await send(Endpoints.playlistOrder(id), method: "PUT", body: ["song_ids": songIDs]))
    }

    func albums() async throws -> [Album] {
        try JSONDecoder().decode([Album].self, from: await send(Endpoints.albums, method: "GET", timeout: 60))
    }

    func album(_ id: String) async throws -> Album {
        try JSONDecoder().decode(Album.self, from: await send(Endpoints.album(id), method: "GET"))
    }

    func usage() async throws -> ServerUsage {
        try JSONDecoder().decode(ServerUsage.self, from: await send(Endpoints.meUsage, method: "GET", timeout: 15))
    }
}
