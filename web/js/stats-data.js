import { hasAudio } from './playable.js';
import { displayYear } from './credits.js';
import { familyIndex, FAMILY_PALETTE_SIZE } from './genre-data.js';
import { songGenres, mapToNodes } from './genre-playing.js';

export const BPM_DEFAULT = { lo: 60, hi: 200 };
export const MIN_YEAR_SPAN = 10;
export const MIN_ZOOM_YEARS = 2;
export const MIN_ZOOM_BPM = 8;
export const JITTER_YEAR = 0.34;
export const JITTER_BPM = 1.4;
export const PALETTE_SIZE = 12;
export { FAMILY_PALETTE_SIZE };
export const DEFAULT_MODE = 'family';
export const NEUTRAL = -1;
export const COLOR_MODES = [
  ['family', 'Genre family'], ['decade', 'Decade'], ['audio', 'Audio on server'], ['none', 'None'],
];

export const MIN_BPM = 20;
export const MAX_BPM = 300;
export const MIN_YEAR = 1900;
export const maxYear = () => new Date().getFullYear() + 1;

const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export const validBpm = (v) => inRange(v, MIN_BPM, MAX_BPM);
export const validYear = (v) => inRange(v, MIN_YEAR, maxYear());

export function splitPlottable(songs) {
  const plotted = [];
  let skipped = 0;
  for (const s of songs || []) {
    if (validYear(displayYear(s)) && validBpm(s.bpm)) plotted.push(s);
    else skipped += 1;
  }
  return { plotted, skipped };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function jitter(id) {
  const h = hash(String(id));
  const a = (h & 0xffff) / 0x10000;
  const b = (hash(`${h}:${id}`) & 0xffff) / 0x10000;
  return { dx: (a * 2 - 1) * JITTER_YEAR, dy: (b * 2 - 1) * JITTER_BPM };
}

export function makePoint(song) {
  const j = jitter(song.id);
  return { id: song.id, song, year: displayYear(song), bpm: song.bpm, x: displayYear(song) + j.dx, y: song.bpm + j.dy };
}

export function extentX(years) {
  if (!years.length) return { lo: 2000, hi: 2000 + MIN_YEAR_SPAN };
  let lo = Math.min(...years) - 1;
  let hi = Math.max(...years) + 1;
  if (hi - lo < MIN_YEAR_SPAN) {
    const extra = MIN_YEAR_SPAN - (hi - lo);
    lo -= Math.floor(extra / 2);
    hi = lo + MIN_YEAR_SPAN;
  }
  return { lo, hi };
}

export function extentY(bpms) {
  let { lo, hi } = BPM_DEFAULT;
  if (bpms.length) {
    const min = Math.min(...bpms);
    const max = Math.max(...bpms);
    if (min < lo) lo = Math.max(0, Math.floor((min - 5) / 20) * 20);
    if (max > hi) hi = Math.ceil((max + 5) / 20) * 20;
  }
  return { lo, hi };
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

export function tickStep(span, maxTicks, minStep = 1) {
  const want = span / Math.max(1, maxTicks);
  for (const s of STEPS) if (s >= want && s >= minStep) return s;
  return Math.ceil(want / 100) * 100;
}

export function clampLo(range, floor = 0) {
  return range.lo >= floor ? range : { lo: floor, hi: floor + (range.hi - range.lo) };
}

export function ticks(lo, hi, step) {
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

export function makeScale(lo, hi, p0, p1) {
  const k = (p1 - p0) / (hi - lo);
  return { to: (v) => p0 + (v - lo) * k, from: (p) => lo + (p - p0) / k };
}

export function zoomRange(lo, hi, anchor, factor, { minSpan, maxSpan }) {
  const span = Math.min(maxSpan, Math.max(minSpan, (hi - lo) * factor));
  const t = hi === lo ? 0.5 : (anchor - lo) / (hi - lo);
  const nlo = anchor - t * span;
  return { lo: nlo, hi: nlo + span };
}

export function centerRange(lo, hi, bounds) {
  const span = hi - lo;
  const nlo = (bounds.lo + bounds.hi) / 2 - span / 2;
  return { lo: nlo, hi: nlo + span };
}

// With bounds the view centre must stay inside them; nothing else limits the pan.
export function panRange(lo, hi, delta, bounds) {
  const span = hi - lo;
  let nlo = lo + delta;
  if (bounds) {
    nlo = Math.min(bounds.hi - span / 2, Math.max(bounds.lo - span / 2, nlo));
  }
  return { lo: nlo, hi: nlo + span };
}

export const decadeOf = (year) => Math.floor(year / 10) * 10;

function decadeGroup(song) {
  const d = decadeOf(displayYear(song));
  return { key: String(d), label: `${d}s`, order: d };
}

const AUDIO_GROUPS = {
  yes: { key: 'audio', label: 'Audio on server', order: 0 },
  no: { key: 'noaudio', label: 'No audio', order: 1, neutral: true },
};

function audioGroup(song) {
  return hasAudio(song) ? AUDIO_GROUPS.yes : AUDIO_GROUPS.no;
}

const OTHER = 'Other';

const nodeFamilies = new WeakMap();

function familyOfNode(graph, id) {
  let m = nodeFamilies.get(graph);
  if (!m) {
    m = new Map((graph.nodes || []).map((n) => [n.id, n.family]));
    nodeFamilies.set(graph, m);
  }
  return m.get(id);
}

const legacyGenre = (song) => (typeof song?.genre === 'string' && song.genre.trim() ? [`genre:${song.genre}`] : []);

// Family of the first genre (`genre:` tags in tag order, then a legacy plain `genre`) that resolves to a graph node; else 'Other'.
export function songFamily(song, graph) {
  if (!song || !graph?.nodes?.length) return OTHER;
  const genres = songGenres({ tags: [...(song.tags || []), ...legacyGenre(song)] });
  for (const g of mapToNodes(genres, graph)) {
    if (!g.id) continue;
    const fam = familyOfNode(graph, g.id);
    if (fam) return fam;
  }
  return OTHER;
}

export function songFamilies(graph, songs) {
  const out = new Map();
  for (const s of songs) {
    const fam = songFamily(s, graph);
    if (fam !== OTHER) out.set(s.id, fam);
  }
  return out;
}

function familyGroup(song, families) {
  const fam = families?.get(song.id) || OTHER;
  return { key: `f:${fam}`, label: fam, order: familyIndex(fam), other: fam === OTHER };
}

const NONE_GROUP = { key: 'all', label: 'All songs', order: 0 };

export function groupOf(song, mode, families) {
  if (mode === 'family' && !families) return NONE_GROUP;
  if (mode === 'decade') return decadeGroup(song);
  if (mode === 'audio') return audioGroup(song);
  if (mode === 'family') return familyGroup(song, families);
  return NONE_GROUP;
}

export function assignGroups(points, mode, families) {
  const groups = new Map();
  for (const p of points) {
    const g = groupOf(p.song, mode, families);
    let e = groups.get(g.key);
    if (!e) { e = { ...g, count: 0, color: NEUTRAL }; groups.set(g.key, e); }
    e.count += 1;
    p.group = g.key;
  }
  const byOrder = (a, b) => a.order - b.order;
  const byCount = (a, b) => (a.other ? 1 : 0) - (b.other ? 1 : 0) || b.count - a.count || byOrder(a, b);
  const pending = mode === 'family' && !families;
  const list = [...groups.values()].sort(mode === 'family' && !pending ? byCount : byOrder);
  let next = 0;
  for (const g of list) {
    if (mode === 'none' || g.neutral || pending) continue;
    g.color = mode === 'family' ? g.order : next;
    next += 1;
  }
  const byKey = new Map(list.map((g) => [g.key, g]));
  for (const p of points) p.color = byKey.get(p.group).color;
  return list;
}

export const colorIndex = (color, size = PALETTE_SIZE) => (color < 0 ? NEUTRAL : color % size);

export function buildIndex(items, cell = 24) {
  const cells = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  for (let i = 0; i < items.length; i += 1) {
    const k = key(Math.floor(items[i].px / cell), Math.floor(items[i].py / cell));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  function near(x, y, r, ok) {
    let best = -1;
    let bestD = r * r;
    const x0 = Math.floor((x - r) / cell);
    const x1 = Math.floor((x + r) / cell);
    const y0 = Math.floor((y - r) / cell);
    const y1 = Math.floor((y + r) / cell);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        for (const i of cells.get(key(cx, cy)) || []) {
          if (ok && !ok(items[i])) continue;
          const d = (items[i].px - x) ** 2 + (items[i].py - y) ** 2;
          if (d <= bestD) { best = i; bestD = d; }
        }
      }
    }
    return best;
  }
  return { near };
}

export function inRect(items, a, b, ok) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (ok && !ok(it)) continue;
    if (it.px >= x0 && it.px <= x1 && it.py >= y0 && it.py <= y1) out.push(i);
  }
  return out;
}

const DIRS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

export function neighbour(items, from, key, ok) {
  const dir = DIRS[key];
  if (!dir || !items.length) return from;
  if (from < 0 || from >= items.length) return -1;
  const o = items[from];
  let best = from;
  let bestScore = Infinity;
  for (let i = 0; i < items.length; i += 1) {
    if (i === from || (ok && !ok(items[i]))) continue;
    const dx = items[i].px - o.px;
    const dy = items[i].py - o.py;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 0) continue;
    const across = Math.abs(dx * dir[1] - dy * dir[0]);
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function firstItem(items, ok) {
  let best = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (ok && !ok(items[i])) continue;
    if (best < 0 || items[i].px < items[best].px) best = i;
  }
  return best;
}

export function countText(plotted, total) {
  return `${plotted} of ${total} songs plotted`;
}

export function skippedText(n) {
  if (!n) return '';
  const [noun, verb] = n === 1 ? ['song', 'is'] : ['songs', 'are'];
  return `${n} ${noun} without year or BPM ${verb} not shown`;
}

export function chartLabel(n) {
  return `Scatter plot of ${n} ${n === 1 ? 'song' : 'songs'}: year on the horizontal axis, BPM on the vertical axis.`;
}
