#if os(iOS)
import AVFoundation
import SwiftUI
import UIKit

/// Runs the microphone BPM meter. Audio, filters and the estimate live on a private queue; this object only holds what the screen shows.
final class MicBPMPipeline: @unchecked Sendable {
    private let queue = DispatchQueue(label: "cc.electrophone.live-bpm", qos: .userInitiated)
    private let mic = MicBPM()
    private var held = 0.0
    private var timer: DispatchSourceTimer?
    private let onLevel: @Sendable (Double) -> Void
    private let onValue: @Sendable (Double?, Bool) -> Void

    init(onLevel: @escaping @Sendable (Double) -> Void, onValue: @escaping @Sendable (Double?, Bool) -> Void) {
        self.onLevel = onLevel
        self.onValue = onValue
    }

    func start() {
        queue.async { [self] in
            mic.reset()
            held = 0
            let t = DispatchSource.makeTimerSource(queue: queue)
            t.schedule(deadline: .now() + LiveBPMConst.publishS, repeating: LiveBPMConst.publishS)
            t.setEventHandler { [self] in
                let value = mic.value()
                let silent = mic.silent
                DispatchQueue.main.async { self.onValue(value, silent) }
            }
            timer = t
            t.resume()
        }
    }

    func feed(_ samples: [Float], sampleRate: Double) {
        queue.async { [self] in
            mic.push(samples, sampleRate: sampleRate)
            let level = MicBPM.levelFraction(MicBPM.rms(samples))
            held = max(level, held - LiveBPMConst.meterFall)
            let shown = held
            DispatchQueue.main.async { self.onLevel(shown) }
        }
    }

    func stop() {
        queue.async { [self] in
            timer?.cancel()
            timer = nil
            mic.reset()
        }
    }
}

@MainActor
final class MicBPMModel: ObservableObject {
    enum Phase: Equatable {
        case idle, asking, listening, denied, failed, timeout, interrupted, routeChanged, backgrounded
    }

    @Published private(set) var phase = Phase.idle
    @Published private(set) var bpm: Double?
    @Published private(set) var level = 0.0
    @Published private(set) var silent = true

    var isPlayerPlaying: () -> Bool = { false }

    private let engine = AVAudioEngine()
    private var pipeline: MicBPMPipeline?
    private var limit: Task<Void, Never>?
    private var startedAt = Date()
    private var observers: [NSObjectProtocol] = []
    private static let routeGraceS = 1.5

    var running: Bool { phase == .listening }
    var busy: Bool { phase == .asking }

    var stateLine: String {
        switch phase {
        case .idle: "Tap Start to listen"
        case .asking: "Waiting for microphone permission..."
        case .listening: silent ? "Silent: nothing heard" : "Listening..."
        case .denied: "Microphone access is off. Allow it in Settings."
        case .failed: "Could not start the microphone"
        case .timeout: "Stopped: 10 minutes reached"
        case .interrupted: "Stopped: another app or a call took the audio"
        case .routeChanged: "Stopped: the audio route changed"
        case .backgrounded: "Stopped: the app went to the background"
        }
    }

    var isProblem: Bool { phase == .denied || phase == .failed }

    func toggle() {
        if running { stop(.idle) } else if !busy { Task { await start() } }
    }

    func start() async {
        guard !running, !busy else { return }
        phase = .asking
        let granted: Bool
        switch AVAudioApplication.shared.recordPermission {
        case .granted: granted = true
        case .denied: granted = false
        default: granted = await AVAudioApplication.requestRecordPermission()
        }
        guard phase == .asking else { return }
        guard granted else { phase = .denied; return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker])
            try session.setActive(true)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw MicError.noInput }
            let pipe = MicBPMPipeline(
                onLevel: { [weak self] value in Task { @MainActor in self?.heardLevel(value) } },
                onValue: { [weak self] value, silent in Task { @MainActor in self?.heardValue(value, silent) } })
            pipeline = pipe
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 4096, format: format, block: Self.tapBlock(pipe))
            engine.prepare()
            try engine.start()
            pipe.start()
        } catch {
            teardown()
            phase = .failed
            return
        }
        startedAt = Date()
        bpm = nil
        level = 0
        silent = true
        phase = .listening
        observe()
        limit = Task { [weak self] in
            try? await Task.sleep(for: .seconds(LiveBPMConst.maxRunS))
            if !Task.isCancelled { self?.stop(.timeout) }
        }
    }

    func stop(_ next: Phase = .idle) {
        guard phase == .listening || phase == .asking else { return }
        teardown()
        phase = next
    }

    private func heardLevel(_ value: Double) {
        guard running else { return }
        level = value
    }

    private func heardValue(_ value: Double?, _ isSilent: Bool) {
        guard running else { return }
        if bpm != value { bpm = value }
        if silent != isSilent { silent = isSilent }
    }

    private func teardown() {
        limit?.cancel()
        limit = nil
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers = []
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        pipeline?.stop()
        pipeline = nil
        bpm = nil
        level = 0
        silent = true
        PlatformAudio.restorePlayback(playerIsPlaying: isPlayerPlaying())
    }

    private func observe() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            Task { @MainActor in
                if let raw, AVAudioSession.InterruptionType(rawValue: raw) == .began { self?.stop(.interrupted) }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            Task { @MainActor in
                guard let self, let raw, let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
                if (reason == .newDeviceAvailable || reason == .oldDeviceUnavailable) && self.pastGrace { self.stop(.routeChanged) }
            }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.pastGrace else { return }
                self.stop(.routeChanged)
            }
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.stop(.backgrounded) }
        })
    }

    private nonisolated static func tapBlock(_ pipe: MicBPMPipeline) -> AVAudioNodeTapBlock {
        { buffer, _ in
            guard let data = buffer.floatChannelData else { return }
            let n = Int(buffer.frameLength)
            let channels = Int(buffer.format.channelCount)
            var mono = Array(UnsafeBufferPointer(start: data[0], count: n))
            if channels > 1 {
                for c in 1..<channels {
                    let extra = UnsafeBufferPointer(start: data[c], count: n)
                    for i in 0..<n { mono[i] += extra[i] }
                }
                let scale = 1 / Float(channels)
                for i in 0..<n { mono[i] *= scale }
            }
            pipe.feed(mono, sampleRate: buffer.format.sampleRate)
        }
    }

    private var pastGrace: Bool { Date().timeIntervalSince(startedAt) > Self.routeGraceS }

    private enum MicError: Error { case noInput }
}
#endif
