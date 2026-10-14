export function bpmLabel(bpm) {
  const n = Math.round(Number(bpm));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}
