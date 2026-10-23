import { api } from './api.js';
import { storeGet, storeSet } from './storage.js';

export const LAYOUT_KEY = 'electrophone.genresV2Layout';
export const SAVE_DELAY_MS = 5000;
export const MAX_ENTRIES = 2000;
const KEEPALIVE_MAX_CHARS = 60000;
const COORD_MAX = 100000;
const KINDS = [['s:', 'positions'], ['g:', 'families']];

const valid = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_MAX);

export function toDoc(map) {
  const doc = { positions: {}, families: {} };
  let count = 0;
  for (const [id, p] of map) {
    const kind = KINDS.find(([prefix]) => id.startsWith(prefix));
    if (!kind || id.length === 2 || id.length > 202 || !valid(p) || count >= MAX_ENTRIES) continue;
    doc[kind[1]][id.slice(2)] = [Math.round(p[0]), Math.round(p[1])];
    count += 1;
  }
  return doc;
}

export function fromDoc(doc) {
  const out = new Map();
  for (const [prefix, key] of KINDS) {
    const table = doc && typeof doc[key] === 'object' && doc[key] ? doc[key] : {};
    for (const [name, p] of Object.entries(table)) if (valid(p)) out.set(`${prefix}${name}`, [p[0], p[1]]);
  }
  return out;
}

export function createLayoutStore({
  get = () => api.genreLayout(),
  put = (doc, keepalive) => api.putGenreLayout(doc, keepalive),
  read = () => storeGet(LAYOUT_KEY),
  write = (text) => storeSet(LAYOUT_KEY, text),
  now = () => Date.now(),
  delayMs = SAVE_DELAY_MS,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) },
} = {}) {
  let held = new Map();
  let dirty = false;
  let at = 0;
  let rev = 0;
  let timer = null;
  let sending = false;
  let again = false;
  let source = null;
  let offHide = null;

  function readLocal() {
    try {
      const raw = JSON.parse(read() || 'null');
      if (!raw || typeof raw !== 'object') return null;
      return { map: fromDoc(raw), dirty: raw.dirty === true, at: Number(raw.at) || 0 };
    } catch { return null; }
  }

  function persist() {
    write(JSON.stringify({ ...toDoc(held), dirty, at }));
  }

  function gather() {
    if (!source) return;
    const fresh = source.collect();
    const next = new Map(fresh);
    for (const [id, p] of held) if (!next.has(id) && !source.known(id)) next.set(id, p);
    held = next;
  }

  function arm() {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => { timer = null; void flush(); }, delayMs);
  }

  async function flush(keepalive = false, collect = true) {
    if (timer !== null) { timers.clear(timer); timer = null; }
    if (!dirty) return;
    if (sending) { again = true; return; }
    if (collect) gather();
    persist();
    const doc = toDoc(held);
    const sent = rev;
    sending = true;
    try {
      await put(doc, keepalive && JSON.stringify(doc).length < KEEPALIVE_MAX_CHARS);
      if (rev === sent) { dirty = false; persist(); }
    } catch { /* retried on the next change or the next visit */ } finally {
      sending = false;
      if (again) { again = false; if (dirty) arm(); }
    }
  }

  function onHide() {
    if (globalThis.document?.visibilityState === 'hidden' || globalThis.document?.hidden) void flush(true);
  }

  return {
    async sync() {
      const local = readLocal();
      let server = null;
      try { server = await get(); } catch { /* offline or signed out: the local copy stands */ }
      const serverAt = server ? Date.parse(server.updated) || 0 : 0;
      if (!server || (local && local.dirty && local.at >= serverAt)) {
        if (local) { held = local.map; dirty = local.dirty; at = local.at; if (dirty) arm(); }
        return new Map(held);
      }
      held = fromDoc(server);
      dirty = false;
      at = serverAt;
      persist();
      return new Map(held);
    },
    current() { return new Map(held); },
    attach(next) {
      source = next;
      globalThis.addEventListener?.('pagehide', onHide);
      globalThis.document?.addEventListener?.('visibilitychange', onHide);
      offHide = () => {
        globalThis.removeEventListener?.('pagehide', onHide);
        globalThis.document?.removeEventListener?.('visibilitychange', onHide);
      };
    },
    touch() {
      gather();
      dirty = true;
      rev += 1;
      at = now();
      persist();
      arm();
    },
    clear() {
      held = new Map();
      dirty = true;
      rev += 1;
      at = now();
      persist();
      return flush(false, false);
    },
    flush,
    dispose() {
      offHide?.();
      offHide = null;
      void flush(true);
    },
  };
}
