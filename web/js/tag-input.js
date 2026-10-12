export function completeTag(raw) {
  const t = String(raw).trim();
  if (!t) return '';
  const i = t.indexOf(':');
  if (i < 0) return t;
  return t.slice(0, i).trim() && t.slice(i + 1).trim() ? t : '';
}

export function splitInput(raw) {
  const parts = String(raw).split(',').map((x) => x.trim()).filter(Boolean);
  return { tags: parts.map(completeTag).filter(Boolean), rest: parts.filter((p) => !completeTag(p)).join(', ') };
}
