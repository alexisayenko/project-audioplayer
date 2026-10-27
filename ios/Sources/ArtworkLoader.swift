import AVFoundation
import MediaPlayer

/// Where server covers are fetched from: the base address and the legacy token, read when a cover is needed.
struct ArtworkServer: Sendable {
    var base: String
    var token: String
}

/// Lock-screen artwork for a song: the cache, then the cover embedded in the file, then the song's cover from the server.
struct ArtworkLoader: Sendable {
    static let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("artwork", isDirectory: true)

    var directory = Self.directory
    var server: @Sendable () async -> ArtworkServer

    func file(_ id: String) -> URL { directory.appendingPathComponent("\(id).jpg") }

    static func removeCached(_ id: String, in directory: URL = ArtworkLoader.directory) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).jpg"))
    }

    func image(for track: Track) async throws -> PlatformImage? {
        let file = file(track.id)
        if let data = try? Data(contentsOf: file), let img = PlatformImage(data: data) { return img }
        try Task.checkCancellation()
        var data = try await Self.embedded(track.fileURL)
        try Task.checkCancellation()
        if data == nil, let source = track.thumbnail { data = try await remote(source) }
        try Task.checkCancellation()
        guard let data, let img = PlatformImage(data: data) else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? (img.jpegRepresentation(quality: 0.9) ?? data).write(to: file, options: .atomic)
        return img
    }

    static func mediaArtwork(_ image: PlatformImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in image }
    }

    private static func embedded(_ url: URL) async throws -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let items = try await AVURLAsset(url: url).load(.commonMetadata)
        let art = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .commonIdentifierArtwork)
        guard let item = art.first else { return nil }
        return try await item.load(.dataValue)
    }

    private func remote(_ source: String) async throws -> Data? {
        if LocalCover.isLocal(source) { return LocalCover.data(for: source) }
        let address = await server()
        let base = address.base
        let token = address.token
        return try await withThrowingTaskGroup(of: Data?.self) { group in
            group.addTask {
                if source.hasPrefix("/") { return await CoverCache.data(for: source, baseURL: base, token: token) }
                guard let url = CoverURL.resolve(source, baseURL: base, token: "") else { return nil }
                var req = URLRequest(url: url)
                req.timeoutInterval = 10
                return try await URLSession.shared.data(for: req).0
            }
            group.addTask {
                try await Task.sleep(for: .seconds(10))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            return try await group.next() ?? nil
        }
    }
}
