export const VOLUME_STEP = 0.05;

export function clampVolume(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

export function parseVolume(raw, fallback = 1) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? clampVolume(n) : fallback;
}

export function stepVolume(v, dir, step = VOLUME_STEP) {
  return clampVolume(Math.round((clampVolume(v) + dir * step) * 100) / 100);
}

export function volumePercent(v) {
  return Math.round(clampVolume(v) * 100);
}

export function volumeAnnounce(v, muted) {
  return muted || v === 0 ? 'Muted' : `Volume ${volumePercent(v)}%`;
}

export function canSetVolume(audio) {
  try {
    const prev = audio.volume;
    const probe = prev > 0.5 ? 0.25 : 0.75;
    audio.volume = probe;
    const ok = Math.abs(audio.volume - probe) < 0.01;
    audio.volume = prev;
    return ok;
  } catch { return false; }
}

export function nextRepeatLabel(mode) {
  return { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[mode] || 'Repeat off';
}

export function playHotkey(e, { open }) {
  if (!open || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.target?.closest?.('input, textarea, select, dialog, [contenteditable], [role=radiogroup], [role=slider]')) return null;
  switch (e.key) {
    case 's': case 'S': return 'shuffle';
    case 'r': case 'R': return 'repeat';
    case 'ArrowUp': return 'vol-up';
    case 'ArrowDown': return 'vol-down';
    default: return null;
  }
}
