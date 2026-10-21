import { el } from './dom.js';

export const CHECK_MS = 5 * 60 * 1000;
export const MIN_GAP_MS = 30 * 1000;

export function versionFromUrl(url) {
  const m = /(?:^|\/)_v\/([0-9a-f]+)\//.exec(String(url || ''));
  return m ? m[1] : null;
}

export function readVersion(doc = globalThis.document, selfUrl = import.meta.url) {
  return versionFromUrl(selfUrl) || versionFromUrl(doc?.querySelector?.('script[type="module"][src]')?.getAttribute('src'));
}

export const defaultTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };

export async function fetchServerVersion(fetchImpl = globalThis.fetch) {
  const res = await fetchImpl('/version', { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) return null;
  const body = await res.json();
  return typeof body?.version === 'string' && body.version ? body.version : null;
}

export function createUpdateCheck({ current, fetchVersion, isVisible, show, hide, timers = defaultTimers, now = () => Date.now() }) {
  let dismissed = null;
  let shown = null;
  let busy = false;
  let last = -Infinity;
  let timer = null;
  let running = false;

  async function check({ force = false } = {}) {
    if (!current || busy || !isVisible()) return;
    if (!force && now() - last < MIN_GAP_MS) return;
    busy = true;
    last = now();
    try {
      const latest = await fetchVersion();
      if (latest && latest !== current && latest !== dismissed && latest !== shown) {
        shown = latest;
        show(latest);
      }
    } catch {
    } finally {
      busy = false;
    }
  }

  function dismiss() {
    if (shown) dismissed = shown;
    shown = null;
    hide();
  }

  function schedule() {
    if (!running) return;
    timer = timers.set(() => {
      schedule();
      void check({ force: true });
    }, CHECK_MS);
  }

  function start() {
    if (running || !current) return;
    running = true;
    schedule();
  }

  function stop() {
    running = false;
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  return { check, dismiss, start, stop, state: () => ({ current, shown, dismissed }) };
}

function buildBar(onReload, onDismiss) {
  const bar = el('div', { class: 'update-bar t-subhead', role: 'status', 'aria-live': 'polite' },
    el('span', {}, 'A new version is available.'),
    el('button', { type: 'button', class: 'update-reload' }, 'Reload'),
    el('button', { type: 'button', class: 'update-dismiss', 'aria-label': 'Dismiss' }, '×'));
  bar.querySelector('.update-reload').addEventListener('click', onReload);
  bar.querySelector('.update-dismiss').addEventListener('click', onDismiss);
  return bar;
}

export function startUpdateCheck({ doc = document, win = window, fetchImpl = globalThis.fetch } = {}) {
  const current = readVersion(doc);
  if (!current) return null;
  let bar = null;
  const ctl = createUpdateCheck({
    current,
    fetchVersion: () => fetchServerVersion(fetchImpl),
    isVisible: () => doc.visibilityState === 'visible',
    show: () => {
      if (bar) return;
      bar = buildBar(() => win.location.reload(), () => ctl.dismiss());
      doc.body.append(bar);
    },
    hide: () => {
      bar?.remove();
      bar = null;
    },
  });
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') void ctl.check(); });
  win.addEventListener('focus', () => { void ctl.check(); });
  ctl.start();
  void ctl.check();
  return ctl;
}
