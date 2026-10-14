// Pure view model for the download progress indicator (Library row ring, queue rows, mini-player).
// Input: what autodl.view(id) returns: { kind, progress (0..1), error, minutes }.

export const RADIUS = 9;
export const CIRC = Math.round(2 * Math.PI * RADIUS * 100) / 100;

const r2 = (n) => Math.round(n * 100) / 100;

// 0..1 fraction (or junk) -> whole percent 0..100.
export function percent(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(1, n)) * 100);
}

const ring = { track: true };

// Returns null when nothing is being fetched, else
// { state, label, text, role, now (null = indeterminate), dash, offset, line (0..100), indeterminate, idle, actionable }.
export function ringModel(v) {
  if (!v) return null;
  const base = { ...ring, role: 'progressbar', now: null, text: '', dash: `${CIRC}`, offset: 0, line: 0, indeterminate: false, idle: false, actionable: false };
  switch (v.kind) {
    case 'queued':
      return { ...base, state: 'queued', label: 'Queued', dash: '3 4', idle: true };
    case 'paused':
      return { ...base, state: 'queued', label: `Paused - resumes in ${Math.max(1, Number(v.minutes) || 1)} min`, dash: '3 4', idle: true };
    case 'downloading': {
      const n = percent(v.progress);
      return { ...base, state: 'downloading', label: `Downloading ${n}%`, now: n, text: String(n), offset: r2(CIRC * (1 - n / 100)), line: n };
    }
    case 'converting':
      return { ...base, state: 'converting', label: 'Converting', text: '...', dash: `${r2(CIRC * 0.28)} ${CIRC}`, indeterminate: true, line: 100 };
    case 'done':
      return { ...base, state: 'done', label: 'Done', now: 100, text: '100', line: 100 };
    case 'failed':
      return { ...base, state: 'failed', label: 'Failed - click to retry', role: 'button', actionable: true };
    default:
      return null;
  }
}

// Longer text for queue rows and the mini-player.
export function statusText(v, short = false) {
  const m = ringModel(v);
  if (!m) return 'Not downloaded';
  if (m.state === 'queued' && v.kind === 'queued') return short ? 'Queued' : 'Queued for download';
  if (m.state === 'failed') return short ? 'Download failed' : `Download failed: ${v.error}`;
  if (m.state === 'downloading' && !percent(v.progress)) return 'Downloading...';
  return m.label;
}
