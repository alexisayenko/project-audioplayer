import AVFoundation
import Combine
import SwiftUI

enum VizMode: String, CaseIterable, Identifiable {
    case bars, ring

    var id: String { rawValue }
    var label: String { self == .bars ? "Mirrored spectrum" : "Ring" }
    var symbol: String { self == .bars ? "chart.bar.fill" : "circle.dashed" }
    var next: VizMode { self == .bars ? .ring : .bars }
}

/// Owns the audio tap on the playing item and says honestly whether real levels are arriving.
@MainActor
final class MacVisualizer: ObservableObject {
    static let shared = MacVisualizer()
    static let silenceLimit = 3.0

    enum Status: Equatable {
        case idle, pending, active
        case unavailable(String)
    }

    @Published private(set) var status: Status = .idle
    @Published var isOpen = false
    @Published var mode = VizMode(rawValue: UserDefaults.standard.string(forKey: "ap2.viz.mode") ?? "") ?? .bars {
        didSet { UserDefaults.standard.set(mode.rawValue, forKey: "ap2.viz.mode") }
    }

    let levels = VizLevels()
    private var counter = 0
    private var active = 0
    private var contexts = NSMapTable<AVPlayerItem, VizTapContext>(keyOptions: .weakMemory, valueOptions: .strongMemory)
    private var failures = NSMapTable<AVPlayerItem, NSString>(keyOptions: .weakMemory, valueOptions: .strongMemory)
    private weak var tapped: AVPlayerItem?
    private var played = 0.0
    private var lastPosition = 0.0
    private weak var player: PlayerService?
    private var bag = Set<AnyCancellable>()

    var available: Bool { if case .unavailable = status { return false }; return true }

    var tooltip: String {
        switch status {
        case .unavailable(let why): return "Visualizer (V): unavailable. \(why)"
        default: return "Visualizer (V)"
        }
    }

    func install(player: PlayerService) {
        guard self.player == nil else { return }
        self.player = player
        player.itemObserver = { [weak self] item in
            MainActor.assumeIsolated { self?.activate(item) }
        }
        player.$position.sink { [weak self] p in self?.tick(p) }.store(in: &bag)
    }

    func toggle() {
        if isOpen { isOpen = false } else if available, player?.current != nil { isOpen = true }
    }

    /// Builds the tap before the item starts playing, so the audio mix never changes mid-playback.
    func prepare(_ item: AVPlayerItem) async {
        counter += 1
        let token = counter
        let tracks = await Self.audioTracks(of: item.asset)
        guard let track = tracks?.first else {
            failures.setObject((tracks == nil ? "The stream's audio track did not load." : "The stream has no audio track.") as NSString, forKey: item)
            return
        }
        guard let context = VizTapContext(token: token, levels: levels), let mix = VizTap.make(context: context, track: track) else {
            failures.setObject("The audio tap could not be created.", forKey: item)
            return
        }
        item.audioMix = mix
        contexts.setObject(context, forKey: item)
    }

    private static func audioTracks(of asset: AVAsset) async -> [AVAssetTrack]? {
        await withTaskGroup(of: [AVAssetTrack]?.self) { group in
            group.addTask { try? await asset.loadTracks(withMediaType: .audio) }
            group.addTask {
                try? await Task.sleep(for: .seconds(8))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private func activate(_ item: AVPlayerItem?) {
        tapped?.audioMix = nil
        tapped = nil
        played = 0
        lastPosition = 0
        guard let item else {
            active = 0
            levels.activate(0)
            status = .idle
            return
        }
        if let context = contexts.object(forKey: item) {
            tapped = item
            active = context.token
            levels.activate(context.token)
            status = .pending
            NSLog("viz tap: attached, waiting for callbacks")
        } else {
            active = 0
            levels.activate(0)
            let why = (failures.object(forKey: item) as String?) ?? "The audio tap was not set up for this song."
            status = .unavailable(why)
            NSLog("viz tap: unavailable (\(why))")
        }
    }

    private func tick(_ position: Double) {
        defer { lastPosition = position }
        guard active != 0, let player else { return }
        let snap = levels.snapshot()
        if snap.unsupported, status != .unavailable("The tap delivers an audio format the visualizer cannot read.") {
            status = .unavailable("The tap delivers an audio format the visualizer cannot read.")
            NSLog("viz tap: callbacks arrived but the audio format is unsupported")
            return
        }
        if snap.callbacks > 0 {
            if status != .active {
                let late = status != .pending
                status = .active
                NSLog("viz tap: callbacks arrived (\(snap.callbacks)\(late ? ", late" : "")), after %.1f s of playback", played)
            }
            return
        }
        let delta = position - lastPosition
        if player.isPlaying, delta > 0, delta < 1.5 { played += delta }
        if case .pending = status, played >= Self.silenceLimit {
            let why = "No audio levels reached the app within \(Int(Self.silenceLimit)) s of playback."
            status = .unavailable(why)
            NSLog("viz tap: NO callbacks after %.1f s of playback, visualizer unavailable", played)
            isOpen = false
        }
    }
}
