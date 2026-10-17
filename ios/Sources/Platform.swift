import AVFoundation
import SwiftUI

#if os(iOS)
import UIKit
typealias PlatformImage = UIImage
#else
import AppKit
typealias PlatformImage = NSImage
#endif

extension PlatformImage {
    func jpegRepresentation(quality: Double) -> Data? {
        #if os(iOS)
        return jpegData(compressionQuality: quality)
        #else
        guard let tiff = tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .jpeg, properties: [.compressionFactor: quality])
        #endif
    }
}

extension Image {
    init(platformImage: PlatformImage) {
        #if os(iOS)
        self.init(uiImage: platformImage)
        #else
        self.init(nsImage: platformImage)
        #endif
    }
}

enum PlatformAudio {
    /// iOS needs a playback session for background audio; macOS has no audio session.
    static func configure() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        #endif
    }

    static func activate() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
    }
}
