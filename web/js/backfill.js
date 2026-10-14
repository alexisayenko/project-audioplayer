import { plural } from './dom.js';

export const POLL_MS = 2000;

export const processed = (s) => (s.done || 0) + (s.failed || 0) + (s.skipped || 0);

export function isRunning(s) {
  return s?.state === 'running';
}

export function canStart(s) {
  return !!s && !isRunning(s) && s.candidates > 0;
}

export function candidateText(n) {
  if (!n) return 'Every song with audio has a BPM.';
  return `${n} ${plural(n, 'song has', 'songs have')} audio but no BPM`;
}

export function progressPercent(s) {
  if (!s?.total) return 0;
  return Math.min(100, Math.round((processed(s) / s.total) * 100));
}

export function progressText(s) {
  const failed = s.failed ? ` (${s.failed} failed)` : '';
  return `Detecting... ${processed(s)} of ${s.total}${failed}`;
}

export function finalText(s) {
  const tally = `${s.done} detected, ${s.failed} failed, ${s.skipped} skipped`;
  if (s.state === 'done') return `Done: ${tally}. Reload the library to see new BPMs`;
  if (s.state === 'cancelled') return `Cancelled: ${tally}.`;
  if (s.state === 'error') {
    const reason = s.last_error ? ` (${s.last_error})` : '';
    return `Stopped by an error after ${tally}${reason}.`;
  }
  return '';
}

export function isFinal(s) {
  return s?.state === 'done' || s?.state === 'cancelled' || s?.state === 'error';
}

export function statusText(s) {
  if (isRunning(s)) return progressText(s);
  if (isFinal(s) && (s.done || s.failed || s.skipped)) return finalText(s);
  return '';
}
