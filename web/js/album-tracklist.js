const TOTAL = /^total(?:\s+(?:length|time|duration|runtime))?\s*[:=-]?\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*$/i;
const TAIL = /(?:^|[\s|–—-])[(\[]?\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*[)\]]?\s*$/;
const LEAD = /^\s*\d+\s*(?:[.)]\s*|-\s+|\s+)/;
const SPLIT = /\s+[-–—]\s+/;

export function parseDuration(text) {
  const parts = String(text ?? '').trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n))) return null;
  if (parts.slice(1).some((n) => n > 59)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function parseTrackList(text) {
  const tracks = [];
  const warnings = [];
  let total = null;
  String(text ?? '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const t = TOTAL.exec(line);
    if (t) { total = parseDuration(t[1]); return; }
    let rest = line;
    let length = null;
    const m = TAIL.exec(rest);
    if (m) {
      length = parseDuration(m[1]);
      if (length !== null) rest = rest.slice(0, m.index).trim();
    }
    rest = rest.replace(LEAD, '').trim();
    let artist = '';
    const cut = SPLIT.exec(rest);
    if (cut) {
      artist = rest.slice(0, cut.index).trim();
      rest = rest.slice(cut.index + cut[0].length).trim();
    }
    if (!rest) { warnings.push(`Skipped "${line}": no title.`); return; }
    if (length === null) warnings.push(`"${rest}" has no length.`);
    tracks.push({ artist, title: rest, length });
  });
  const sum = listLength(tracks);
  if (total !== null && tracks.length && Math.abs(sum - total) > 5) warnings.push('The lines do not add up to the Total length line.');
  return { tracks, total, warnings };
}

export const listLength = (tracks) => tracks.reduce((acc, t) => acc + (t.length || 0), 0);

export function startsOf(tracks) {
  let at = 0;
  return tracks.map((t) => {
    const start = at;
    at += t.length || 0;
    return start;
  });
}

export const MISMATCH_SECONDS = 5;

export function scaleStarts(starts, sum, target) {
  if (!(sum > 0) || !(target > 0)) return starts.slice();
  return starts.map((s) => Math.round((s * target) / sum));
}

export function mismatchText(sum, duration, clock) {
  if (!(duration > 0) || Math.abs(sum - duration) <= MISMATCH_SECONDS) return '';
  const diff = clock(Math.abs(sum - duration));
  return `Track list is ${diff} ${sum < duration ? 'shorter' : 'longer'} than the video`;
}
