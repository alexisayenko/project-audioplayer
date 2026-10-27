import MediaPlayer

/// What the lock screen and Control Center show for the current song.
struct NowPlayingSnapshot {
    var track: Track
    var title: String
    var artist: String
    var duration: Double
    var position: Double
    var isPlaying: Bool
    var artwork: MPMediaItemArtwork?
}

enum NowPlaying {
    static func info(_ snapshot: NowPlayingSnapshot) -> [String: Any] {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: snapshot.title,
            MPMediaItemPropertyArtist: snapshot.artist,
            MPMediaItemPropertyPlaybackDuration: snapshot.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: snapshot.position,
            MPNowPlayingInfoPropertyPlaybackRate: snapshot.isPlaying ? 1.0 : 0.0,
        ]
        if let album = snapshot.track.album, !album.isEmpty { info[MPMediaItemPropertyAlbumTitle] = album }
        if let artwork = snapshot.artwork { info[MPMediaItemPropertyArtwork] = artwork }
        return info
    }

    static func publish(_ snapshot: NowPlayingSnapshot?, isPlaying: Bool) {
        #if os(macOS)
        if snapshot == nil { MPNowPlayingInfoCenter.default().playbackState = .stopped }
        else { MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused }
        #endif
        MPNowPlayingInfoCenter.default().nowPlayingInfo = snapshot.map(info)
    }
}

/// The lock-screen and headset commands, forwarded to the player.
struct RemoteHandlers {
    var play: @MainActor () -> Void
    var pause: @MainActor () -> Void
    var toggle: @MainActor () -> Void
    var next: @MainActor () -> Void
    var previous: @MainActor () -> Void
    var skip: @MainActor (Double) -> Void
    var seek: @MainActor (Double) -> Void
}

enum RemoteCommands {
    static func install(_ handlers: RemoteHandlers) {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { _ in
            Task { @MainActor in handlers.play() }
            return .success
        }
        center.pauseCommand.addTarget { _ in
            Task { @MainActor in handlers.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in handlers.toggle() }
            return .success
        }
        center.nextTrackCommand.addTarget { _ in
            Task { @MainActor in handlers.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { _ in
            Task { @MainActor in handlers.previous() }
            return .success
        }
        #if os(macOS)
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { _ in
            Task { @MainActor in handlers.skip(10) }
            return .success
        }
        center.skipBackwardCommand.addTarget { _ in
            Task { @MainActor in handlers.skip(-10) }
            return .success
        }
        #endif
        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in handlers.seek(position) }
            return .success
        }
    }
}
