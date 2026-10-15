import { camClamp } from './viz-terrain-math.js';

export const SHARE_VERSION = 1;
export const SHARE_MAX_T = 86400;
export const SHARE_MODES = ['bars', 'ring', 'terrain', 'synthwave'];
export const SHARE_STYLES = ['relief', 'single', 'hill', 'multi', 'full', 'lava', 'melody'];

const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const ROUTE_RE = /^#\/?play\/([^?#]*)(?:\?(.*))?$/;
const CAM_KEYS = ['eye', 'pitch', 'yaw'];

export const isShareHash = (hash) => ROUTE_RE.test(String(hash ?? ''));

export function clampT(t, duration) {
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n) || n < 0) return 0;
  const cap = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : SHARE_MAX_T;
  return Math.min(n, cap, SHARE_MAX_T);
}

export function parseClock(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,6}(:\d{1,2}){0,2}$/.test(s)) return null;
  const parts = s.split(':').map(Number);
  if (parts.length > 1 && parts.slice(1).some((p) => p > 59)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function fmtClock(sec) {
  const s = clampT(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

const round = (n, d) => Number(n.toFixed(d));

export function buildShareUrl({
  origin, id, t = 0, viz = null, style = null, bg = null, fs = false, cam = null, fl = false, duration = null,
}) {
  if (!ID_RE.test(String(id ?? ''))) return null;
  const q = [`v=${SHARE_VERSION}`];
  const at = clampT(t, duration);
  if (at > 0) q.push(`t=${at}`);
  if (SHARE_MODES.includes(viz)) {
    q.push(`viz=${viz}`);
    if (viz === 'terrain' && SHARE_STYLES.includes(style)) q.push(`style=${style}`);
  }
  if (bg === true || bg === false) q.push(`bg=${bg ? 1 : 0}`);
  if (fs) q.push('fs=1');
  if (fl && viz === 'terrain') q.push('fl=1');
  if (cam) {
    const c = camClamp(cam);
    q.push(`cam=${[round(c.eye, 2), round(c.pitch, 1), round(c.yaw, 1)].join(',')}`);
  }
  return `${String(origin ?? '').replace(/\/+$/, '')}/#/play/${encodeURIComponent(id)}?${q.join('&')}`;
}

function parseCam(raw) {
  if (raw == null) return null;
  const parts = raw.split(',');
  if (parts.length !== CAM_KEYS.length || parts.some((p) => !/^-?\d+(\.\d+)?$/.test(p))) return null;
  const [eye, pitch, yaw] = parts.map(Number);
  const { eye: e, pitch: p, yaw: y } = camClamp({ eye, pitch, yaw });
  return { eye: e, pitch: p, yaw: y };
}

export function parseShareParams(hash) {
  const m = ROUTE_RE.exec(String(hash ?? ''));
  if (!m) return null;
  let id;
  try { id = decodeURIComponent(m[1]); } catch { return null; }
  if (!ID_RE.test(id)) return null;
  const q = new URLSearchParams(m[2] ?? '');
  const t = q.get('t');
  const viz = q.get('viz');
  const style = q.get('style');
  const bg = q.get('bg');
  return {
    id,
    t: t != null && /^\d{1,7}$/.test(t) ? clampT(t) : 0,
    viz: SHARE_MODES.includes(viz) ? viz : null,
    style: SHARE_STYLES.includes(style) ? style : null,
    bg: bg === '1' ? true : bg === '0' ? false : null,
    fs: q.get('fs') === '1',
    cam: parseCam(q.get('cam')),
    fl: q.get('fl') === '1' && viz === 'terrain',
  };
}

export const camDiffers = (cam) => {
  const base = camClamp({});
  return CAM_KEYS.some((k) => Math.abs((cam?.[k] ?? base[k]) - base[k]) > 1e-6);
};
