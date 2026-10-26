import Accelerate
import AVFoundation
import MediaToolbox
import os

let vizBandCount = 64

/// Latest spectrum written by the audio thread and read by the UI; only the tap whose token is active may write.
final class VizLevels: @unchecked Sendable {
    struct Snapshot {
        var bands: [Float]
        var callbacks: Int
        var age: Double
        var unsupported: Bool
    }

    private struct State {
        var token = 0
        var bands = [Float](repeating: 0, count: vizBandCount)
        var callbacks = 0
        var stamp: CFAbsoluteTime = 0
        var unsupported = false
    }

    private let lock = OSAllocatedUnfairLock(initialState: State())

    func activate(_ token: Int) {
        lock.withLock { $0 = State(token: token) }
    }

    func publish(token: Int, bands: UnsafeBufferPointer<Float>?, unsupported: Bool = false) {
        lock.withLockUnchecked { s in
            guard s.token == token else { return }
            s.callbacks += 1
            s.stamp = CFAbsoluteTimeGetCurrent()
            if unsupported { s.unsupported = true }
            if let bands, bands.count == vizBandCount { for i in 0..<vizBandCount { s.bands[i] = bands[i] } }
        }
    }

    func snapshot() -> Snapshot {
        lock.withLock { s in
            Snapshot(bands: s.bands, callbacks: s.callbacks,
                     age: s.stamp == 0 ? .infinity : CFAbsoluteTimeGetCurrent() - s.stamp, unsupported: s.unsupported)
        }
    }
}

/// Per-item tap state. Callbacks arrive on an audio thread; everything used there is allocated up front.
final class VizTapContext {
    static let fftSize = 2048
    private static let log2n: vDSP_Length = 11

    let token: Int
    let levels: VizLevels
    private var sampleRate: Double = 44100
    private var isFloat = true
    private var bitsPerChannel: UInt32 = 32
    private var interleaved = false
    private var channels = 1
    private var formatOK = true

    private let setup: FFTSetup
    private var window = [Float](repeating: 0, count: VizTapContext.fftSize)
    private var ring = [Float](repeating: 0, count: VizTapContext.fftSize)
    private var ringPos = 0
    private var lin = [Float](repeating: 0, count: VizTapContext.fftSize)
    private var windowed = [Float](repeating: 0, count: VizTapContext.fftSize)
    private var re = [Float](repeating: 0, count: VizTapContext.fftSize / 2)
    private var im = [Float](repeating: 0, count: VizTapContext.fftSize / 2)
    private var mag = [Float](repeating: 0, count: VizTapContext.fftSize / 2)
    private var out = [Float](repeating: 0, count: vizBandCount)
    private var ranges = [(Int, Int)](repeating: (0, 1), count: vizBandCount)
    private var tilt = [Float](repeating: 0, count: vizBandCount)

    init?(token: Int, levels: VizLevels) {
        guard let setup = vDSP_create_fftsetup(Self.log2n, FFTRadix(kFFTRadix2)) else { return nil }
        self.setup = setup
        self.token = token
        self.levels = levels
        vDSP_hann_window(&window, vDSP_Length(Self.fftSize), Int32(vDSP_HANN_NORM))
        configureBands()
    }

    deinit { vDSP_destroy_fftsetup(setup) }

    private func configureBands() {
        let lo = 30.0
        let hi = min(16000.0, sampleRate / 2 - 100)
        let binWidth = sampleRate / Double(Self.fftSize)
        let top = Self.fftSize / 2 - 1
        for k in 0..<vizBandCount {
            let a = lo * pow(hi / lo, Double(k) / Double(vizBandCount))
            let b = lo * pow(hi / lo, Double(k + 1) / Double(vizBandCount))
            let first = min(max(Int(a / binWidth), 1), top)
            let last = min(max(Int(b / binWidth), first), top)
            ranges[k] = (first, last)
            tilt[k] = Float(3 * log2((a * b).squareRoot() / 500))
        }
    }

    func prepare(_ format: AudioStreamBasicDescription) {
        sampleRate = format.mSampleRate > 0 ? format.mSampleRate : 44100
        isFloat = format.mFormatFlags & kAudioFormatFlagIsFloat != 0
        bitsPerChannel = format.mBitsPerChannel
        interleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        channels = max(Int(format.mChannelsPerFrame), 1)
        formatOK = (isFloat && bitsPerChannel == 32) || (!isFloat && bitsPerChannel == 16)
        configureBands()
        ringPos = 0
        for i in 0..<ring.count { ring[i] = 0 }
    }

    func process(_ list: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        guard formatOK else { return levels.publish(token: token, bands: nil, unsupported: true) }
        guard frames > 0 else { return levels.publish(token: token, bands: nil) }
        let buffers = UnsafeMutableAudioBufferListPointer(list)
        guard buffers.count > 0 else { return levels.publish(token: token, bands: nil) }
        let n = Self.fftSize
        for f in 0..<frames {
            var sum: Float = 0
            var count: Float = 0
            if interleaved, let base = buffers[0].mData {
                let stride = max(Int(buffers[0].mNumberChannels), 1)
                for c in 0..<stride {
                    sum += sample(base, f * stride + c)
                    count += 1
                }
            } else {
                for b in buffers {
                    guard let base = b.mData, f < Int(b.mDataByteSize) / (bitsPerChannel == 16 ? 2 : 4) else { continue }
                    sum += sample(base, f)
                    count += 1
                }
            }
            ring[ringPos] = count > 0 ? sum / count : 0
            ringPos = (ringPos + 1) % n
        }
        for i in 0..<n { lin[i] = ring[(ringPos + i) % n] }
        vDSP_vmul(lin, 1, window, 1, &windowed, 1, vDSP_Length(n))
        re.withUnsafeMutableBufferPointer { rp in
            im.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                Self.pack(windowed, into: &split, count: n)
                vDSP_fft_zrip(setup, &split, 1, Self.log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&split, 1, &mag, 1, vDSP_Length(n / 2))
            }
        }
        let norm = Float(n) / 2
        for k in 0..<vizBandCount {
            let (a, b) = ranges[k]
            var peak: Float = 0
            for j in a...b where mag[j] > peak { peak = mag[j] }
            let db = 20 * log10f(peak / norm + 1e-9) + tilt[k]
            out[k] = min(max((db + 80) / 70, 0), 1)
        }
        out.withUnsafeBufferPointer { levels.publish(token: token, bands: $0) }
    }

    private static func pack(_ input: [Float], into split: inout DSPSplitComplex, count n: Int) {
        input.withUnsafeBufferPointer { w in
            w.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: n / 2) {
                vDSP_ctoz($0, 2, &split, 1, vDSP_Length(n / 2))
            }
        }
    }

    @inline(__always)
    private func sample(_ base: UnsafeMutableRawPointer, _ i: Int) -> Float {
        if isFloat { return base.assumingMemoryBound(to: Float.self)[i] }
        return Float(base.assumingMemoryBound(to: Int16.self)[i]) / 32768
    }
}

private let tapInit: MTAudioProcessingTapInitCallback = { _, clientInfo, storageOut in
    storageOut.pointee = clientInfo
}

private let tapFinalize: MTAudioProcessingTapFinalizeCallback = { tap in
    Unmanaged<VizTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
}

private let tapPrepare: MTAudioProcessingTapPrepareCallback = { tap, _, format in
    Unmanaged<VizTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().prepare(format.pointee)
}

private let tapUnprepare: MTAudioProcessingTapUnprepareCallback = { _ in
    // No per-tap state to release.
}

private let tapProcess: MTAudioProcessingTapProcessCallback = { tap, frames, _, list, framesOut, flagsOut in
    guard MTAudioProcessingTapGetSourceAudio(tap, frames, list, flagsOut, nil, framesOut) == noErr else { return }
    Unmanaged<VizTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
        .process(list, frames: Int(framesOut.pointee))
}

enum VizTap {
    /// Builds a pass-through tap for the audio track; the context is released when the tap is finalized.
    static func make(context: VizTapContext, track: AVAssetTrack) -> AVMutableAudioMix? {
        var callbacks = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: Unmanaged.passRetained(context).toOpaque(),
            init: tapInit, finalize: tapFinalize, prepare: tapPrepare, unprepare: tapUnprepare, process: tapProcess)
        var tap: MTAudioProcessingTap?
        let status = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap)
        guard status == noErr, let tap else {
            Unmanaged.passUnretained(context).release()
            return nil
        }
        let params = AVMutableAudioMixInputParameters(track: track)
        params.audioTapProcessor = tap
        let mix = AVMutableAudioMix()
        mix.inputParameters = [params]
        return mix
    }
}
