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

    /// Back to the player's session after a microphone tool: stays active while a song plays, otherwise lets other apps resume.
    static func restorePlayback(playerIsPlaying: Bool) {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        if playerIsPlaying {
            try? session.setCategory(.playback, mode: .default)
            try? session.setActive(true)
        } else {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(.playback, mode: .default)
        }
        #endif
    }

    static func activate() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
    }
}
