import { whenGateOpen } from './load-gate.js';
import { PREFETCH_BATCH, PREFETCH_COVER_WAIT_MS, PREFETCH_BATCH_WAIT_MS, PREFETCH_IDLE_MS } from './constants.js';

export function slowConnection(conn = globalThis.navigator?.connection) {
  return !!conn && (conn.saveData === true || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g');
}

export function readTier2(doc = document) {
  try {
    const list = JSON.parse(doc.getElementById('tier2-modules')?.textContent || '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

const once = (target, names, ms, setTimer = setTimeout) => new Promise((resolve) => {
  const done = () => { for (const n of names) target.removeEventListener(n, done); resolve(); };
  for (const n of names) target.addEventListener(n, done, { once: true });
  setTimer(done, ms);
});

export function whenLoaded(win = window) {
  return win.document.readyState === 'complete' ? Promise.resolve() : once(win, ['load'], PREFETCH_BATCH_WAIT_MS * 4, win.setTimeout.bind(win));
}

export function coversSettled(doc = document, ms = PREFETCH_COVER_WAIT_MS) {
  const pending = [...doc.querySelectorAll('img.cover[fetchpriority="high"]')].filter((img) => img.getAttribute('src') && !img.complete);
  if (!pending.length) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map((img) => once(img, ['load', 'error'], ms))),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

function idle(win) {
  return new Promise((resolve) => {
    if (win.requestIdleCallback) win.requestIdleCallback(() => resolve(), { timeout: PREFETCH_IDLE_MS });
    else win.setTimeout(resolve, 50);
  });
}

function fetchBatch(doc, hrefs, waitMs) {
  return Promise.all(hrefs.map((href) => new Promise((resolve) => {
    const link = doc.createElement('link');
    link.rel = 'modulepreload';
    link.href = href;
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    doc.head.append(link);
    setTimeout(resolve, waitMs);
  })));
}

/** Tier 2: warm the lazy modules quietly, a few at a time, when the browser is idle. Resolves when every batch has been fetched. */
export async function prefetchModules(list, { win = window, batch = PREFETCH_BATCH, waitMs = PREFETCH_BATCH_WAIT_MS * 4 } = {}) {
  for (let i = 0; i < list.length; i += batch) {
    await whenGateOpen();
    await idle(win);
    await whenGateOpen();
    await fetchBatch(win.document, list.slice(i, i + batch), waitMs);
  }
  globalThis.performance?.mark?.('tier2-done');
}

export async function startBackgroundLoad({ win = window, conn = win.navigator?.connection } = {}) {
  const list = readTier2(win.document);
  if (!list.length || slowConnection(conn)) return false;
  await whenLoaded(win);
  await coversSettled(win.document);
  await prefetchModules(list, { win });
  return true;
}
