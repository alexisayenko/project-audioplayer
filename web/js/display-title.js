import { splitTokens } from './tokens.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function displayTitle(song) {
  const title = String(song?.title ?? '');
  const seen = norm(title);
  const parts = splitTokens(song?.remixer ?? '').filter((p) => {
    const n = norm(p);
    return n && !seen.includes(n);
  });
  return { title, remix: parts.join(', ') };
}

export function displayString(song) {
  const { title, remix } = displayTitle(song);
  return remix ? `${title} (${remix})` : title;
}

export function titleNodes(song, titleClass = 'ttl', remixClass = 'rmx') {
  const { title, remix } = displayTitle(song);
  const a = document.createElement('span');
  a.className = titleClass;
  a.textContent = title;
  if (!remix) return [a];
  const b = document.createElement('span');
  b.className = remixClass;
  b.textContent = `(${remix})`;
  return [a, b];
}
