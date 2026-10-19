export const MAX_SHADES = 10;

export const SHADE_OFFSETS = {
  1: { dH: 0, dL: 0 },
  2: { dH: 4, dL: -0.17 },
  3: { dH: 81, dL: 0.08 },
  4: { dH: -21, dL: 0.15 },
  5: { dH: -81, dL: 0.05 },
  6: { dH: -89, dL: -0.11 },
  7: { dH: 109, dL: 0.22 },
  8: { dH: 110, dL: -0.05 },
  9: { dH: -110, dL: 0.17 },
  10: { dH: 110, dL: -0.19 },
};

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function parseColor(text) {
  const s = String(text ?? '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    const n = Number.parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(255, Math.round(v)));
  return null;
}

export function toOklch([r, g, b]) {
  const R = lin(r / 255);
  const G = lin(g / 255);
  const B = lin(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
}

function fromOklch(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0')).join('')}`;

export function shadeColor(base, order) {
  const rgb = parseColor(base);
  const off = SHADE_OFFSETS[order];
  if (!rgb || !off) return null;
  const { L, C, h } = toOklch(rgb);
  const L2 = Math.min(0.97, Math.max(0.08, L + off.dL));
  const h2 = (((h + off.dH) % 360) + 360) % 360;
  let c = C;
  let out = fromOklch(L2, c, h2);
  for (let i = 0; i < 24 && !inGamut(out); i++) { c *= 0.92; out = fromOklch(L2, c, h2); }
  return hex(out);
}

export const shadeTable = (base) => {
  const out = [null];
  for (let order = 1; order <= MAX_SHADES; order++) out.push(shadeColor(base, order));
  return out;
};
