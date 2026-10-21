export const FADE_MAX = 15;
export const FADE_STEP = 1;
export const FADE_CEILING = 60;
export const FADE_IN_KEY = 'ap2.fadePct.in';
export const FADE_OUT_KEY = 'ap2.fadePct.out';
export const START_WINDOW = 0.25;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const known = (d) => num(d) && d > 0;

export function normalizePercent(v) {
  const n = Number(v);
  if (v === null || v === '' || !Number.isFinite(n) || n <= 0 || n > FADE_MAX) return 0;
  return Math.round(n / FADE_STEP) * FADE_STEP;
}

export function fadeLabel(v) {
  const n = normalizePercent(v);
  return n === 0 ? 'Off' : `${n} %`;
}

export function capFade(percent, duration) {
  const n = normalizePercent(percent);
  if (n === 0 || !known(duration)) return 0;
  return Math.min((n * duration) / 100, FADE_CEILING, duration / 2);
}

export function fadeHint(percent, duration) {
  const s = capFade(percent, duration);
  if (s <= 0) return '';
  return `≈ ${s < 10 ? Number(s.toFixed(1)) : Math.round(s)} s on this song`;
}

function windows({ duration, fadeIn, fadeOut }) {
  return { fi: capFade(fadeIn, duration), fo: capFade(fadeOut, duration) };
}

export function gainAt({ time, duration, fadeIn = 0, fadeOut = 0, inActive = true, enabled = true }) {
  if (!enabled || !num(time)) return 1;
  const { fi, fo } = windows({ duration, fadeIn, fadeOut });
  let g = 1;
  if (inActive && fi > 0 && time < fi) g = Math.min(g, Math.max(0, time / fi));
  if (fo > 0 && known(duration) && duration - time < fo) g = Math.min(g, Math.max(0, (duration - time) / fo));
  return g;
}

export function schedule({ time, duration, fadeIn = 0, fadeOut = 0, inActive = true, enabled = true, rate = 1 }) {
  const level = gainAt({ time, duration, fadeIn, fadeOut, inActive, enabled });
  if (!enabled || !num(time)) return { level, points: [] };
  const speed = num(rate) && rate > 0 ? rate : 1;
  const { fi, fo } = windows({ duration, fadeIn, fadeOut });
  const at = (t) => Math.max(0, (t - time) / speed);
  const points = [];
  if (inActive && fi > 0 && time < fi) points.push({ dt: at(fi), gain: 1 });
  if (fo > 0 && known(duration)) {
    const from = duration - fo;
    if (time < from) points.push({ dt: at(from), gain: 1 });
    points.push({ dt: at(duration), gain: 0 });
  }
  return { level, points };
}

export function startsSong(time) {
  return !num(time) || time < START_WINDOW;
}
