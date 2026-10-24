import * as realGraph from './audio-graph.js';

export const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
export const INPUT_FFT_SIZE = 16384;
export const INPUT_SMOOTHING = 0.4;
export const SAMPLE_BLOCK = 4096;
export const DEVICE_GRACE_MS = 1500;

export function errorKey(ex) {
  const name = ex?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
}

export function createMicInput(env = {}) {
  const nav = env.navigator ?? globalThis.navigator;
  const Ctx = env.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const onSamples = typeof env.onSamples === 'function' ? env.onSamples : null;
  let live = null;
  let token = 0;
  let starting = false;

  function release() {
    const r = live;
    if (!r) return;
    live = null;
    if (r.proc) r.proc.onaudioprocess = null;
    r.off.forEach((fn) => fn());
    for (const n of r.nodes) n.disconnect();
    for (const t of r.stream.getTracks()) t.stop();
    void r.ctx.close?.();
  }

  return {
    get live() { return live !== null; },
    get starting() { return starting; },
    get analyser() { return live?.analyser ?? null; },
    get sampleRate() { return live?.ctx.sampleRate ?? 0; },
    async start(onEnd) {
      if (live || starting) return false;
      if (!nav?.mediaDevices?.getUserMedia || !Ctx) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      const mine = ++token;
      starting = true;
      let ctx = null;
      let stream = null;
      try {
        ctx = new Ctx();
        void ctx.resume?.();
        stream = await nav.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        if (mine !== token) throw Object.assign(new Error('cancelled'), { cancelled: true });
        if (ctx.state === 'suspended') await ctx.resume();
        if (mine !== token) throw Object.assign(new Error('cancelled'), { cancelled: true });
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = INPUT_FFT_SIZE;
        analyser.smoothingTimeConstant = INPUT_SMOOTHING;
        // Silent sink (gain 0): some browsers only pull an analyser that reaches the destination.
        const sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(analyser);
        const nodes = [source, analyser, sink];
        let proc = null;
        if (onSamples) {
          // Same stream as the analyser: the tempo engine reads raw samples from this node, so one getUserMedia serves both.
          proc = ctx.createScriptProcessor(SAMPLE_BLOCK, 1, 1);
          proc.onaudioprocess = (e) => onSamples(e.inputBuffer.getChannelData(0), ctx.sampleRate);
          analyser.connect(proc);
          proc.connect(sink);
          nodes.push(proc);
        } else {
          analyser.connect(sink);
        }
        sink.connect(ctx.destination);
        const off = [];
        const listen = (target, type, fn) => { target?.addEventListener?.(type, fn); off.push(() => target?.removeEventListener?.(type, fn)); };
        const startedAt = Date.now();
        for (const t of stream.getTracks()) listen(t, 'ended', () => onEnd?.('ended'));
        listen(nav.mediaDevices, 'devicechange', () => { if (Date.now() - startedAt > DEVICE_GRACE_MS) onEnd?.('devices'); });
        live = { ctx, stream, analyser, proc, nodes, off };
        starting = false;
        return true;
      } catch (ex) {
        if (mine === token) starting = false;
        for (const t of stream?.getTracks?.() ?? []) t.stop();
        void ctx?.close?.();
        if (ex?.cancelled) return false;
        throw ex;
      }
    },
    stop() {
      token += 1;
      starting = false;
      release();
    },
  };
}

export function createPlayerInput(env = {}) {
  const graph = env.graph ?? realGraph;
  const doc = env.document ?? globalThis.document;
  const audio = env.audio ?? doc?.getElementById?.('audio') ?? null;

  return {
    get available() { return audio !== null; },
    get playing() { return audio !== null && !audio.paused && !audio.ended; },
    get analyser() { return graph.getAnalyser(); },
    get sampleRate() { return graph.getContext()?.sampleRate ?? 0; },
    get failed() {
      const s = graph.getState();
      return s === 'failed' || s === 'unsupported' || !graph.isSupported();
    },
    ensure() {
      if (!audio) return;
      const s = graph.getState();
      if (s === 'running' || s === 'failed' || s === 'unsupported' || !graph.isSupported()) return;
      graph.unlock(audio);
    },
  };
}
