export const RESUME_KEY = 'ap2.resume';
export const SAVE_EVERY_MS = 5000;
export const MIN_RESUME_S = 3;
export const END_MARGIN_S = 5;

const okNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function createResumePosition({ storage, now = () => Date.now(), key = RESUME_KEY, every = SAVE_EVERY_MS } = {}) {
  let lastSaveAt = -Infinity;

  function read() {
    try {
      const raw = storage.get(key);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v || typeof v.id !== 'string' || !v.id || !okNum(v.t) || v.t < 0) return null;
      return { id: v.id, t: v.t };
    } catch { return null; }
  }

  function save(id, t) {
    if (!id || !okNum(t) || t < 0) return false;
    lastSaveAt = now();
    try { storage.set(key, JSON.stringify({ id, t: Math.round(t * 10) / 10 })); return true; } catch { return false; }
  }

  function tick(id, t) {
    if (now() - lastSaveAt < every) return false;
    return save(id, t);
  }

  function clear() {
    lastSaveAt = -Infinity;
    try { storage.remove(key); } catch { /* storage unavailable */ }
  }

  function positionFor(id, duration) {
    const v = read();
    if (!v || v.id !== id) return 0;
    if (!okNum(duration) || duration <= 0) return 0;
    if (v.t <= MIN_RESUME_S || v.t >= duration - END_MARGIN_S) return 0;
    return v.t;
  }

  return { read, save, tick, clear, positionFor };
}
