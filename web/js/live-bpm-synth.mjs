export function clickEnergy(bpm, seconds, { rate = 50, start = 0.3, floor = 0.05, offset = 0 } = {}) {
  const frames = [];
  const period = 60 / bpm;
  for (let i = 0; i < seconds * rate; i += 1) {
    const t = i / rate;
    const since = (t - start - offset) % period;
    const k = t >= start + offset ? since : -1;
    frames.push({ t, e: k >= 0 && k < 0.04 ? 0.9 - k * 10 : floor });
  }
  return frames;
}
