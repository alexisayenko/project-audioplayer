export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

function addKick(buf, at, sampleRate, amp) {
  const start = Math.round(at * sampleRate);
  const len = Math.round(0.3 * sampleRate);
  let phase = 0;
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * (48 + 90 * Math.exp(-t / 0.02))) / sampleRate;
    if (start + i >= 0) buf[start + i] += amp * 0.8 * Math.sin(phase) * Math.exp(-t / 0.07);
  }
}

function addBurst(buf, at, sampleRate, amp, tau, length, rand) {
  const start = Math.round(at * sampleRate);
  const len = Math.round(length * sampleRate);
  for (let i = 0; i < len && start + i < buf.length; i += 1) {
    if (start + i >= 0) buf[start + i] += amp * gauss(rand) * Math.exp(-i / sampleRate / tau);
  }
}

export function beatTimes({ bpm, seconds, phase = 0, jitter = 0, seed = 1 }) {
  const rand = rng(seed * 7919 + 13);
  const period = 60 / bpm;
  const out = [];
  for (let k = 0; phase + k * period < seconds; k += 1) out.push(phase + k * period + jitter * gauss(rand));
  return out;
}

export function segment({ bpm, seconds, sampleRate = 44100, kind = 'kick', phase = 0, jitter = 0, noise = 0, hats = true, seed = 1, times = null }) {
  const rand = rng(seed);
  const buf = new Float32Array(Math.round(seconds * sampleRate));
  const period = 60 / bpm;
  for (const at of times ?? beatTimes({ bpm, seconds, phase, jitter, seed })) {
    if (kind === 'kick') {
      addKick(buf, at, sampleRate, 1);
      if (hats) addBurst(buf, at + period / 2, sampleRate, 0.12, 0.012, 0.06, rand);
    } else {
      addBurst(buf, at, sampleRate, 0.8, 0.002, 0.02, rand);
    }
  }
  if (noise > 0) for (let i = 0; i < buf.length; i += 1) buf[i] += noise * gauss(rand);
  return buf;
}

export function concat(parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function feed(det, audio, sampleRate = 44100, block = 2205) {
  for (let i = 0; i < audio.length; i += block) det.pushSamples(audio.subarray(i, Math.min(audio.length, i + block)), sampleRate);
}
