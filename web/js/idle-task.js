const IDLE_TIMEOUT_MS = 1500;
const FALLBACK_MS = 200;

/** Run `fn` when the browser is idle (a short timer where requestIdleCallback is missing); returns a cancel function. */
export function whenIdle(fn, win = globalThis) {
  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, FALLBACK_MS);
  return () => clearTimeout(id);
}
