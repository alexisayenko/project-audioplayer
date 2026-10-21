import Foundation
import ImageIO

/// Covers of songs added without an account: JPEG files in `Application Support/covers-local`, referenced as `local-cover:<song id>`.
enum LocalCover {
    static let prefix = "local-cover:"
    static let directory = LibraryStore.support.appendingPathComponent("covers-local", isDirectory: true)

    static func isLocal(_ source: String?) -> Bool { source?.hasPrefix(prefix) == true }

    static func source(for id: String) -> String { prefix + id }

    private static func file(_ source: String) -> URL? {
        guard isLocal(source) else { return nil }
        let id = String(source.dropFirst(prefix.count))
        guard !id.isEmpty, !id.contains("/"), id != ".", id != ".." else { return nil }
        return directory.appendingPathComponent(id + ".jpg")
    }

    @discardableResult
    static func write(_ data: Data, for id: String) -> String? {
        guard let url = file(source(for: id)), CGImageSourceCreateWithData(data as CFData, nil).map({ CGImageSourceGetCount($0) > 0 }) == true else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        do { try data.write(to: url, options: .atomic) } catch { return nil }
        return source(for: id)
    }

    static func remove(_ id: String) {
        if let url = file(source(for: id)) { try? FileManager.default.removeItem(at: url) }
    }

    static func data(for source: String) -> Data? {
        file(source).flatMap { try? Data(contentsOf: $0) }
    }

    /// The cover downsampled to at most `pixels` on its long side, decoded off the main thread.
    static func image(for source: String, pixels: Int) async -> PlatformImage? {
        await Task.detached(priority: .userInitiated) { () -> PlatformImage? in
            guard let url = file(source), let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: pixels,
            ]
            guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, options as CFDictionary) else { return nil }
            #if os(iOS)
            return PlatformImage(cgImage: cg)
            #else
            return PlatformImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
            #endif
        }.value
    }
}
