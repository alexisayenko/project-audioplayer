import * as realGraph from './audio-graph.js';
import { errorKey, DEVICE_GRACE_MS } from './mic-tool.js';

export const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
export const INPUT_FFT_SIZE = 16384;
export const INPUT_SMOOTHING = 0.4;

export function createMicInput(env = {}) {
  const nav = env.navigator ?? globalThis.navigator;
  const Ctx = env.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let live = null;
  let token = 0;
  let starting = false;

  function release() {
    const r = live;
    if (!r) return;
    live = null;
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
        analyser.connect(sink);
        sink.connect(ctx.destination);
        const off = [];
        const listen = (target, type, fn) => { target?.addEventListener?.(type, fn); off.push(() => target?.removeEventListener?.(type, fn)); };
        const startedAt = Date.now();
        for (const t of stream.getTracks()) listen(t, 'ended', () => onEnd?.('ended'));
        listen(nav.mediaDevices, 'devicechange', () => { if (Date.now() - startedAt > DEVICE_GRACE_MS) onEnd?.('devices'); });
        live = { ctx, stream, analyser, nodes: [source, analyser, sink], off };
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

export { errorKey };
