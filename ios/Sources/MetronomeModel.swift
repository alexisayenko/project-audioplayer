#if os(iOS)
import AVFoundation
import SwiftUI
import UIKit

/// Calls back once per screen refresh while it runs.
final class DisplayLinkDriver: NSObject {
    private var link: CADisplayLink?
    var onFrame: (() -> Void)?

    func start() {
        guard link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func tick() { onFrame?() }
}

@MainActor
final class MetronomeModel: ObservableObject {
    private enum Key {
        static let bpm = "tools.metronome.bpm"
        static let beats = "tools.metronome.beats"
        static let haptic = "tools.metronome.haptic"
    }

    @Published var bpm: Int {
        didSet {
            let clamped = TapTempo.clamp(bpm)
            if clamped != bpm { bpm = clamped }
            UserDefaults.standard.set(bpm, forKey: Key.bpm)
            engine.setTempo(bpm: bpm)
        }
    }
    @Published var beats: Int {
        didSet {
            let clamped = min(max(beats, MetronomeLimits.beats.lowerBound), MetronomeLimits.beats.upperBound)
            if clamped != beats { beats = clamped }
            UserDefaults.standard.set(beats, forKey: Key.beats)
            engine.setBeats(beats)
        }
    }
    @Published var hapticTick: Bool {
        didSet { UserDefaults.standard.set(hapticTick, forKey: Key.haptic) }
    }
    @Published private(set) var running = false
    @Published private(set) var currentBeat: Int?
    @Published private(set) var failed: String?

    private let engine = MetronomeEngine()
    private let driver = DisplayLinkDriver()
    private var tapTempo = TapTempo()
    private var lastCount = 0
    private var ownPlayback = false
    var isMicListening: () -> Bool = { false }
    private var observer: NSObjectProtocol?
    private let accentHaptic = UIImpactFeedbackGenerator(style: .medium)
    private let normalHaptic = UIImpactFeedbackGenerator(style: .light)

    init() {
        let defaults = UserDefaults.standard
        let storedBPM = defaults.integer(forKey: Key.bpm)
        let storedBeats = defaults.integer(forKey: Key.beats)
        bpm = storedBPM == 0 ? MetronomeLimits.defaultBPM : TapTempo.clamp(storedBPM)
        beats = storedBeats == 0 ? MetronomeLimits.defaultBeats : min(max(storedBeats, MetronomeLimits.beats.lowerBound), MetronomeLimits.beats.upperBound)
        hapticTick = defaults.bool(forKey: Key.haptic)
        driver.onFrame = { [weak self] in self?.frame() }
        engine.onStopped = { [weak self] in self?.stop(ownPlayback: self?.ownPlayback ?? false) }
    }

    func toggle(ownPlayback: Bool) {
        if running { stop(ownPlayback: ownPlayback) } else { start(ownPlayback: ownPlayback) }
    }

    func start(ownPlayback: Bool) {
        guard !running else { return }
        self.ownPlayback = ownPlayback
        failed = nil
        do {
            if !ownPlayback && !isMicListening() {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try session.setActive(true)
            }
            try engine.start(bpm: bpm, beats: beats)
        } catch {
            release(ownPlayback: ownPlayback)
            failed = "Could not start the audio output. Try again."
            return
        }
        lastCount = 0
        currentBeat = nil
        running = true
        accentHaptic.prepare()
        normalHaptic.prepare()
        driver.start()
        observer = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.stop(ownPlayback: false) }
        }
    }

    func stop(ownPlayback: Bool) {
        guard running else { return }
        running = false
        driver.stop()
        engine.stop()
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        release(ownPlayback: ownPlayback)
        currentBeat = nil
    }

    private func release(ownPlayback: Bool) {
        guard !isMicListening() else { return }
        PlatformAudio.restorePlayback(playerIsPlaying: ownPlayback)
    }

    func tap() {
        if let tapped = tapTempo.tap(at: ProcessInfo.processInfo.systemUptime) { bpm = tapped }
    }

    func nudge(_ delta: Int) { bpm += delta }

    func commit(text: String) {
        if let value = MetronomeMath.parse(text) { bpm = value }
    }

    private func frame() {
        guard let snap = engine.snapshot(), snap.count != lastCount, snap.secondsSince >= 0 else { return }
        lastCount = snap.count
        let index = MetronomeMath.beatInBar(count: snap.count - 1, beats: beats)
        currentBeat = index
        if hapticTick { (index == 0 ? accentHaptic : normalHaptic).impactOccurred() }
    }
}
#endif
