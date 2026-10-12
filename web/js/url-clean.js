const YT = [
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$/i,
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[/?#].*)?$/i,
  /^(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[/?#].*)?$/i,
];
const TRACKING = new Set(['si', 'feature', 'pp', 'fbclid', 'gclid']);

export function cleanUrl(input) {
  const text = String(input ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return `https://www.youtube.com/watch?v=${text}`;
  for (const rx of YT) {
    const m = rx.exec(text);
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  let u;
  try { u = new URL(text); } catch { return text; }
  if (!/^https?:$/.test(u.protocol) || !u.search) return text;
  const hash = u.hash;
  const kept = [...u.searchParams].filter(([k]) => !TRACKING.has(k.toLowerCase()) && !k.toLowerCase().startsWith('utm_'));
  u.search = new URLSearchParams(kept).toString();
  u.hash = hash;
  return u.href;
}

export function cleanPasted(input) {
  const text = String(input ?? '').trim();
  const found = /(?:https?:\/\/|(?:www\.|m\.|music\.)?youtu(?:\.be|be\.com)\/)[^\s<>"']+/i.exec(text);
  if (found) return cleanUrl(found[0]);
  return cleanUrl(text.split(/\s*[\r\n]+\s*/)[0]);
}
