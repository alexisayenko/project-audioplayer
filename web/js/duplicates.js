import { creditParts } from './credits.js';

export const DEFAULT_TOLERANCE = 10;
export const MAX_TOLERANCE = 120;

const NOISE_GROUP = /[([{【][^()[\]{}【】]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|clip|free download|explicit)\b[^()[\]{}【】]*[)\]}】]/giu;
const SEP = '\u0001';

export function normText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function titleKey(song) {
  const { title, remix } = creditParts(song);
  const base = normText(String(title).replace(NOISE_GROUP, ' '));
  return `${base}${SEP}${normText(remix)}`;
}

export const lengthOf = (song) => {
  const d = Number(song?.duration);
  return Number.isFinite(d) && d > 0 ? d : null;
};

export function clampTolerance(value) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n) || n < 0) return DEFAULT_TOLERANCE;
  return Math.min(MAX_TOLERANCE, n);
}

// Songs are sorted by length (ties by id). A group starts at the shortest song not yet grouped and takes every following
// song whose length is within `tolerance` seconds of that first song, so a group spans at most `tolerance` seconds and never chains.
function clusters(songs, tolerance) {
  const sorted = [...songs].sort((a, b) => lengthOf(a) - lengthOf(b) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    const first = lengthOf(sorted[i]);
    let j = i + 1;
    while (j < sorted.length && lengthOf(sorted[j]) - first <= tolerance) j += 1;
    if (j - i > 1) out.push(sorted.slice(i, j));
    i = j;
  }
  return out;
}

export function findDuplicates(songs, { tolerance = DEFAULT_TOLERANCE, byTitle = true } = {}) {
  const tol = clampTolerance(tolerance);
  const timed = (songs || []).filter((s) => lengthOf(s) != null);
  let buckets = [timed];
  if (byTitle) {
    const map = new Map();
    for (const s of timed) {
      const key = titleKey(s);
      if (key.startsWith(SEP)) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    buckets = [...map.values()];
  }
  return buckets.flatMap((b) => clusters(b, tol))
    .sort((a, b) => lengthOf(a[0]) - lengthOf(b[0]) || String(a[0].id).localeCompare(String(b[0].id)));
}

export function summary(groups) {
  const songs = groups.reduce((n, g) => n + g.length, 0);
  return { groups: groups.length, songs };
}
