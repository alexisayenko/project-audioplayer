export const splitAll = (raw) => String(raw).split(/[,/]/).map((p) => p.trim()).filter(Boolean);

export function splitChips(raw) {
  const s = String(raw);
  const at = Math.max(s.lastIndexOf(','), s.lastIndexOf('/'));
  if (at < 0) return { parts: [], rest: s };
  return { parts: splitAll(s.slice(0, at)), rest: s.slice(at + 1).trimStart() };
}
