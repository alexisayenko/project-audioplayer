#if os(iOS)
import AVFoundation

/// Everything the render callback touches. It is only written from the main thread as whole aligned values
/// and read on the audio thread; a stale read is one buffer late at worst.
final class ClickState {
    let sampleRate: Double
    let accent: UnsafeMutablePointer<Float>
    let normal: UnsafeMutablePointer<Float>
    let clickLength: Int
    let samplesPerBeat: UnsafeMutablePointer<Double>
    let beats: UnsafeMutablePointer<Int>
    let beatCount: UnsafeMutablePointer<Int>
    let beatHostTime: UnsafeMutablePointer<UInt64>

    var untilNext: Double = 0
    var clickPos: Int
    var playing: UnsafeMutablePointer<Float>
    var started = 0

    init(sampleRate: Double, bpm: Int, beats count: Int) {
        self.sampleRate = sampleRate
        let hi = ClickSound.render(frequency: 1760, amplitude: 0.9, sampleRate: sampleRate)
        let lo = ClickSound.render(frequency: 1175, amplitude: 0.6, sampleRate: sampleRate)
        clickLength = hi.count
        accent = .allocate(capacity: hi.count)
        normal = .allocate(capacity: lo.count)
        accent.initialize(from: hi, count: hi.count)
        normal.initialize(from: lo, count: lo.count)
        samplesPerBeat = .allocate(capacity: 1)
        samplesPerBeat.initialize(to: MetronomeMath.samplesPerBeat(bpm: bpm, sampleRate: sampleRate))
        beats = .allocate(capacity: 1)
        beats.initialize(to: count)
        beatCount = .allocate(capacity: 1)
        beatCount.initialize(to: 0)
        beatHostTime = .allocate(capacity: 1)
        beatHostTime.initialize(to: 0)
        clickPos = hi.count
        playing = normal
    }

    deinit {
        accent.deallocate()
        normal.deallocate()
        samplesPerBeat.deallocate()
        beats.deallocate()
        beatCount.deallocate()
        beatHostTime.deallocate()
    }

    /// Fills `frames` samples; a beat starts on the exact frame its time falls in, so clicks are sample-accurate.
    func render(frames: Int, hostTime: UInt64, left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>?) {
        let perBeat = samplesPerBeat.pointee
        if untilNext > perBeat { untilNext = perBeat }
        let barLength = max(beats.pointee, 1)
        for i in 0..<frames {
            if untilNext <= 0 {
                playing = started % barLength == 0 ? accent : normal
                clickPos = 0
                started += 1
                beatHostTime.pointee = hostTime &+ AVAudioTime.hostTime(forSeconds: Double(i) / sampleRate)
                beatCount.pointee = started
                untilNext += perBeat
            }
            untilNext -= 1
            var v: Float = 0
            if clickPos < clickLength {
                v = playing[clickPos]
                clickPos += 1
            }
            left[i] = v
            right?[i] = v
        }
    }
}

@MainActor
final class MetronomeEngine {
    private let engine = AVAudioEngine()
    private var node: AVAudioSourceNode?
    private var state: ClickState?
    private var configObserver: NSObjectProtocol?
    private(set) var isRunning = false

    var onStopped: (() -> Void)?

    deinit {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
    }

    func setTempo(bpm: Int) {
        guard let state else { return }
        state.samplesPerBeat.pointee = MetronomeMath.samplesPerBeat(bpm: bpm, sampleRate: state.sampleRate)
    }

    func setBeats(_ beats: Int) { state?.beats.pointee = beats }

    func start(bpm: Int, beats: Int) throws {
        guard !isRunning else { return }
        let rate = AVAudioSession.sharedInstance().sampleRate
        let sampleRate = rate > 0 ? rate : 44100
        let click = ClickState(sampleRate: sampleRate, bpm: bpm, beats: beats)
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
        let source = Self.makeSource(click: click, format: format)
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        node = source
        state = click
        engine.prepare()
        do {
            try engine.start()
        } catch {
            teardown()
            throw error
        }
        isRunning = true
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.routeChanged() }
        }
    }

    nonisolated private static func makeSource(click: ClickState, format: AVAudioFormat) -> AVAudioSourceNode {
        AVAudioSourceNode(format: format) { _, timestamp, frames, audio in
            let list = UnsafeMutableAudioBufferListPointer(audio)
            guard let left = list.first?.mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            let right = list.count > 1 ? list[1].mData?.assumingMemoryBound(to: Float.self) : nil
            click.render(frames: Int(frames), hostTime: timestamp.pointee.mHostTime, left: left, right: right)
            return noErr
        }
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        teardown()
    }

    /// The count of beats started and how long ago the latest one reached the speaker (negative: not yet).
    func snapshot() -> (count: Int, secondsSince: Double)? {
        guard isRunning, let state, state.beatCount.pointee > 0 else { return nil }
        let now = mach_absolute_time()
        let beat = state.beatHostTime.pointee
        let seconds = now >= beat ? AVAudioTime.seconds(forHostTime: now - beat) : -AVAudioTime.seconds(forHostTime: beat - now)
        return (state.beatCount.pointee, seconds)
    }

    private func routeChanged() {
        guard isRunning else { return }
        if !engine.isRunning {
            do { try engine.start() } catch {
                stop()
                onStopped?()
            }
        }
    }

    private func teardown() {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = nil
        engine.stop()
        if let node { engine.detach(node) }
        node = nil
        state = nil
    }
}
#endif
