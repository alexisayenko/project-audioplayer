const NONE = { level: 'none', text: '', label: '', dot: false };

export function normalizeSync(raw) {
  if (raw && typeof raw === 'object') return { ...raw, state: raw.state || 'ok' };
  return { state: typeof raw === 'string' && raw ? raw : 'ok' };
}

const count = (n) => `${n} ${n === 1 ? 'change' : 'changes'}`;

function reason(s) {
  const err = String(s.last_error || '').toLowerCase();
  if ((s.repos || []).some((r) => r.rejected)) return 'push rejected';
  if (err.includes('no upstream')) return 'no upstream';
  return 'not reaching git';
}

export function describeSync(raw, nowMs = Date.now()) {
  const s = normalizeSync(raw);
  if (s.state === 'ok') return { ...NONE, text: 'In sync with git' };
  if (s.state === 'pending') return { ...NONE, text: 'Saving to git' };
  if (s.state === 'degraded') return { level: 'warn', text: 'Sync is behind', label: 'Sync is behind', dot: true };
  if (s.state === 'error') {
    return { level: 'error', text: `Sync failed: ${reason(s)}`, label: 'Sync failed', dot: true };
  }
  if (s.state !== 'stale') return NONE;
  if (typeof s.unpushed !== 'number') return { level: 'warn', text: 'Sync is behind', label: 'Sync is behind', dot: true };
  const m = count(s.unpushed);
  if (s.timer_seen === false) {
    return {
      level: 'warn',
      text: `Git push timer not installed or not running, ${m} not pushed`,
      label: `Sync is behind: ${m} not pushed, push timer not running`,
      dot: true,
    };
  }
  const t = s.last_push_at ? Date.parse(s.last_push_at) : NaN;
  const ago = Number.isFinite(t) ? `last pushed ${Math.max(1, Math.round((nowMs - t) / 60000))} min ago` : 'no push recorded';
  return { level: 'warn', text: `${ago}, ${m} not pushed`, label: `Sync is behind: ${m} not pushed`, dot: true };
}
