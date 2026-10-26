export const MIN_CUT = 1;

const PART = /^\d+(?:\.\d)?$/;
const WHOLE = /^\d+$/;

export function parseTime(text) {
  const s = String(text ?? '').trim();
  if (!s) return { empty: true, value: null, ok: true };
  const parts = s.split(':');
  if (parts.length > 3) return { empty: false, value: null, ok: false };
  const last = parts.length - 1;
  if (!parts.every((p, i) => (i === last ? PART.test(p) : WHOLE.test(p)))) return { empty: false, value: null, ok: false };
  if (parts.slice(1).some((p) => Number(p) >= 60)) return { empty: false, value: null, ok: false };
  const nums = parts.map(Number);
  const value = nums.reduce((acc, n) => acc * 60 + n, 0);
  return { empty: false, value: Math.round(value * 10) / 10, ok: true };
}

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const tenths = Math.round(sec * 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const r = String(whole % 60).padStart(2, '0');
  const tail = frac ? `${r}.${frac}` : r;
  return h ? `${h}:${String(m).padStart(2, '0')}:${tail}` : `${m}:${tail}`;
}

function trimError(start, end, dur) {
  if (dur !== null && end !== null && end > dur) return 'End is after the end of the track.';
  if (dur !== null && start !== null && start >= dur) return 'Start is after the end of the track.';
  if (start !== null && end !== null && start >= end) return 'Start must be before End.';
  const to = end ?? dur;
  if (to !== null && to - (start ?? 0) < MIN_CUT) return 'The cut must be at least 1 second.';
  return null;
}

export function validateTrim(startText, endText, duration = null) {
  const a = parseTime(startText);
  const b = parseTime(endText);
  const dur = Number.isFinite(duration) && duration > 0 ? duration : null;
  if (!a.ok) return { error: 'Start must look like 1:25 or 85.', start: null, end: null, length: null };
  if (!b.ok) return { error: 'End must look like 3:10 or 190.', start: null, end: null, length: null };
  const start = a.value;
  const end = b.value;
  const error = trimError(start, end, dur);
  const from = start ?? 0;
  const to = end ?? dur;
  const length = !error && to !== null ? Math.round((to - from) * 10) / 10 : null;
  return { error, start, end, length };
}

export function trimPayload(start, end) {
  const out = {};
  if (start !== null && start !== undefined && start > 0) out.start = start;
  if (end !== null && end !== undefined) out.end = end;
  return Object.keys(out).length ? out : null;
}
