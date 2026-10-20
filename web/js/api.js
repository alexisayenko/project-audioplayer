import { storeRemove } from './storage.js';
import { friendly } from './limits.js';
import { clearGuest } from './guest.js';
import { withRuntimeDecade } from './tagname.js';

storeRemove('audioplayer.token');

export const auth = { email: '', provider: '' };

export function isSignedIn() {
  return !!auth.email;
}

const CSRF = { 'X-Requested-With': 'audioplayer' };

export const startup = {
  maxMs: 20000,
  waiting: false,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

function setWaiting(on) {
  if (startup.waiting === on) return;
  startup.waiting = on;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('server-starting'));
}

async function isStarting(res) {
  if (res.status !== 503) return false;
  try { return (await (res.clone?.() ?? res).json())?.detail === 'starting'; } catch { return false; }
}

/** fetch that waits out a server that is still starting (503 {detail: "starting"}, nothing was processed so every method is safe to repeat); gives the 503 back after startup.maxMs. */
export async function fetchWhenReady(path, init) {
  const began = startup.now();
  try {
    for (;;) {
      const res = await fetch(path, init);
      if (!(await isStarting(res))) return res;
      const wait = Math.max(1, Number(res.headers?.get?.('Retry-After')) || 3) * 1000;
      if (startup.now() - began + wait > startup.maxMs) return res;
      setWaiting(true);
      await startup.sleep(wait); // NOSONAR the next attempt must follow the delay
    }
  } finally {
    setWaiting(false);
  }
}

function lostSession() {
  if (!auth.email) return;
  auth.email = '';
  auth.provider = '';
  window.dispatchEvent(new Event('auth-changed'));
}

export class ApiError extends Error {
  constructor(status, message, code = '', retryMinutes = 0) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryMinutes = retryMinutes;
    this.data = null;
  }
}

function failure(res, data) {
  let detail = data?.detail;
  if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join('; ');
  if (res.status === 401) {
    detail = 'Not signed in (see Settings)';
    lostSession();
  }
  if (res.status === 503 && detail === 'starting') detail = 'The server is starting. Try again in a moment.';
  const code = data?.error || '';
  const err = new ApiError(res.status, friendly(code, data, detail) || `Request failed (${res.status})`, code, Number(data?.retry_after_minutes) || 0);
  err.data = data;
  if (code === 'guest_limit') {
    const ev = new Event('guest-limit');
    ev.detail = err.message;
    window.dispatchEvent(ev);
  }
  return err;
}

async function request(method, path, body, signal, raw = false) {
  const headers = { ...CSRF };
  if (body !== undefined) headers['Content-Type'] = raw ? body.type : 'application/json';
  let res;
  try {
    res = await fetchWhenReady(path, {
      method,
      headers,
      body: body === undefined || raw ? body : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, 'Server unreachable');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw failure(res, data);
  return data;
}

function* parseLines(lines) {
  for (const line of lines) if (line.trim()) yield JSON.parse(line);
}

async function* ndjson(res) {
  if (!res.body?.getReader) {
    yield* parseLines((await res.text()).split('\n'));
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    buf += dec.decode(done ? undefined : value, { stream: !done });
    const lines = buf.split('\n');
    buf = done ? '' : lines.pop();
    yield* parseLines(lines);
    if (done) return;
  }
}

async function openPreviewStream(url, signal) {
  let res;
  try {
    res = await fetchWhenReady('/preview/stream', { method: 'POST', headers: { ...CSRF, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal });
  } catch (ex) {
    if (ex?.name === 'AbortError') throw ex;
    throw new ApiError(0, 'Server unreachable');
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    throw failure(res, data);
  }
  return res;
}

function streamError(ev) {
  const err = new ApiError(ev.status || 500, friendly(ev.error || '', ev, ev.detail) || 'Lookup failed', ev.error || '');
  err.data = ev;
  err.stage = ev.stage || '';
  return err;
}

async function previewStream(url, signal, onEvent) {
  const res = await openPreviewStream(url, signal);
  try {
    for await (const ev of ndjson(res)) {
      if (ev.event === 'result') return ev.data;
      if (ev.event === 'error') throw streamError(ev);
      onEvent(ev);
    }
  } catch (ex) {
    if (ex instanceof ApiError || ex?.name === 'AbortError') throw ex;
    throw new ApiError(0, 'Lookup was interrupted');
  }
  throw new ApiError(0, 'Lookup was interrupted');
}

const q = (id) => encodeURIComponent(id);

async function authCall(method, path, body) {
  const headers = { ...CSRF };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetchWhenReady(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Server unreachable');
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const code = data?.error || '';
    throw new ApiError(res.status, friendly(code, data, data?.detail) || `Request failed (${res.status})`, code);
  }
  return data;
}

export const session = {
  config: () => authCall('GET', '/auth/config'),
  start: async (idToken) => {
    const who = await authCall('POST', '/auth/session', { id_token: idToken });
    auth.email = who.email || who.provider;
    auth.provider = who.provider;
    clearGuest();
    return who;
  },
  end: async () => {
    await authCall('POST', '/auth/logout');
    auth.email = '';
    auth.provider = '';
  },
  retryMs: [500, 1500, 3000],
  restore: async () => {
    for (let i = 0; ; i++) {
      try {
        const who = await authCall('GET', '/auth/me', undefined);
        if (who.method === 'session') {
          auth.email = who.email || who.provider || 'owner';
          auth.provider = who.provider || '';
        }
        return;
      } catch (ex) {
        const transient = !ex.status || ex.status >= 500;
        if (!transient || i >= session.retryMs.length) return;
        await new Promise((r) => setTimeout(r, session.retryMs[i])); // NOSONAR retries must run sequentially with a delay between attempts
      }
    }
  },
};

export const api = {
  me: () => request('GET', '/me'),
  usage: () => request('GET', '/me/usage'),
  library: () => request('GET', '/library').then((d) => d.songs.map(withRuntimeDecade)),
  tags: () => request('GET', '/tags'),
  genreGraph: () => request('GET', '/genres/graph'),
  genres: () => request('GET', '/genres').then((d) => (Array.isArray(d?.genres) ? d.genres : [])),
  genreVocabulary: () => request('GET', '/genres/vocabulary'),
  preview: (url, signal, onEvent) => (onEvent ? previewStream(url, signal, onEvent) : request('POST', '/preview', { url }, signal)),
  metadata: (body, signal) => request('POST', '/metadata', body, signal),
  playlist: (url, signal) => request('POST', '/import/youtube-playlist', { url }, signal),
  playlistDetails: (ids, signal) => request('POST', '/import/youtube-playlist/details', { ids }, signal),
  addSong: (url, metadata, tags, keepTitle = false, sourceRaw = null) => request('POST', '/songs', { url, metadata, tags, audio: false, ...(keepTitle ? { keep_title: true } : {}), ...(sourceRaw ? { source_raw: sourceRaw } : {}) }),
  patch: (id, changes) => request('PATCH', `/songs/${q(id)}`, changes),
  fetchAudio: (id) => request('POST', `/songs/${q(id)}/audio`),
  songStatus: (id) => request('GET', `/songs/${q(id)}/status`),
  detectBpm: (id) => request('POST', `/songs/${q(id)}/bpm/detect`),
  identify: (id) => request('POST', `/songs/${q(id)}/identify`),
  identifyState: (id) => request('GET', `/songs/${q(id)}/identify`),
  backfillBpm: () => request('GET', '/me/backfill/bpm'),
  startBackfillBpm: () => request('POST', '/me/backfill/bpm'),
  cancelBackfillBpm: () => request('DELETE', '/me/backfill/bpm'),
  backfillMetadata: () => request('GET', '/me/backfill/metadata'),
  startBackfillMetadata: () => request('POST', '/me/backfill/metadata'),
  cancelBackfillMetadata: () => request('DELETE', '/me/backfill/metadata'),
  remove: (id) => request('DELETE', `/songs/${q(id)}`),
  drafts: () => request('GET', '/drafts'),
  addDrafts: (lines) => request('POST', '/drafts', { lines }),
  patchDraft: (id, body) => request('PATCH', `/drafts/${q(id)}`, body),
  refreshDraft: (id) => request('POST', `/drafts/${q(id)}/refresh`),
  removeDraft: (id) => request('DELETE', `/drafts/${q(id)}`),
  clearDrafts: () => request('DELETE', '/drafts'),
  fileUrl: (id) => `/files/${q(id)}`,
  downloadUrl: (id) => `/files/${q(id)}?download=1`,
  uploadCover: (id, file) => request('PUT', `/songs/${q(id)}/cover`, file, undefined, true),
  coverFromUrl: (id, url) => request('POST', `/songs/${q(id)}/cover/from-url`, { url }),
  removeCover: (id) => request('DELETE', `/songs/${q(id)}/cover`),
  coverUrl: (id, v) => (v ? `/covers/${q(id)}?v=${encodeURIComponent(v)}` : `/covers/${q(id)}`),
};
