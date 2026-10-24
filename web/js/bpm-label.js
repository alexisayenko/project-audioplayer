export const LIVE_DECIMALS_MAX = 200;
export const LIVE_IDLE = '- - -';

export function liveBpmLabel(bpm) {
  const v = Number(bpm);
  if (!Number.isFinite(v) || v <= 0) return '';
  return v <= LIVE_DECIMALS_MAX ? v.toFixed(1) : String(Math.round(v));
}

export function bpmLabel(bpm) {
  const n = Math.round(Number(bpm));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}
