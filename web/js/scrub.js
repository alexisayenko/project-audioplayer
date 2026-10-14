const SMALL_STEP = 5;
const BIG_STEP = 15;

export const usableDuration = (d) => Number.isFinite(d) && d > 0;

export function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function fraction(time, duration) {
  return usableDuration(duration) ? clamp(time / duration, 0, 1) : 0;
}

export function positionToTime(clientX, rect, duration) {
  if (!usableDuration(duration) || !rect?.width || rect.width <= 0 || !Number.isFinite(clientX)) return null;
  return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
}

const STEPS = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

export function keyTime(key, shift, time, duration) {
  if (!usableDuration(duration)) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return duration;
  const dir = STEPS[key];
  if (!dir) return null;
  return clamp(time + dir * (shift ? BIG_STEP : SMALL_STEP), 0, duration);
}

export function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export const valueText = (time, duration) => `${clock(time)} of ${clock(duration)}`;
