export const SKIP_KEY_TARGETS = 'input, textarea, select, dialog, [contenteditable]';

export function isVizKey(e, { open, route }) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (String(e.key).toLowerCase() !== 'v') return false;
  if (e.target?.closest?.(SKIP_KEY_TARGETS)) return false;
  return open || route === 'playback';
}
