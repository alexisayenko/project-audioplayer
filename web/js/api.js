import { storeRemove } from './storage.js';
import { friendly } from './limits.js';

storeRemove('audioplayer.token');

export const auth = { email: '', provider: '' };

export function isSignedIn() {
  return !!auth.email;
}

const CSRF = { 'X-Requested-With': 'audioplayer' };

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
  }
}

async function request(method, path, body, signal) {
  const headers = { ...CSRF };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, 'Server unreachable');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    let detail = data?.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join('; ');
    if (res.status === 401) {
      detail = 'Not signed in (see Settings)';
      lostSession();
    }
    const code = data?.error || '';
    throw new ApiError(res.status, friendly(code, data, detail) || `Request failed (${res.status})`, code, Number(data?.retry_after_minutes) || 0);
  }
  return data;
}

const q = (id) => encodeURIComponent(id);

async function authCall(method, path, body) {
  const headers = { ...CSRF };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
    return who;
  },
  end: async () => {
    await authCall('POST', '/auth/logout');
    auth.email = '';
    auth.provider = '';
  },
  restore: async () => {
    try {
      const who = await authCall('GET', '/auth/me', undefined);
      if (who.method === 'session') {
        auth.email = who.email || who.provider || 'owner';
        auth.provider = who.provider || '';
      }
    } catch { /* signed out or unreachable */ }
  },
};

export const api = {
  me: () => request('GET', '/me'),
  usage: () => request('GET', '/me/usage'),
  library: () => request('GET', '/library').then((d) => d.songs),
  tags: () => request('GET', '/tags'),
  genreGraph: () => request('GET', '/genres/graph'),
  genres: () => request('GET', '/genres').then((d) => (Array.isArray(d?.genres) ? d.genres : [])),
  preview: (url, signal) => request('POST', '/preview', { url }, signal),
  metadata: (body, signal) => request('POST', '/metadata', body, signal),
  addSong: (url, metadata, tags, keepTitle = false) => request('POST', '/songs', { url, metadata, tags, audio: false, ...(keepTitle ? { keep_title: true } : {}) }),
  patch: (id, changes) => request('PATCH', `/songs/${q(id)}`, changes),
  fetchAudio: (id) => request('POST', `/songs/${q(id)}/audio`),
  songStatus: (id) => request('GET', `/songs/${q(id)}/status`),
  detectBpm: (id) => request('POST', `/songs/${q(id)}/bpm/detect`),
  identify: (id) => request('POST', `/songs/${q(id)}/identify`),
  identifyState: (id) => request('GET', `/songs/${q(id)}/identify`),
  remove: (id) => request('DELETE', `/songs/${q(id)}`),
  fileUrl: (id) => `/files/${q(id)}`,
  downloadUrl: (id) => `/files/${q(id)}?download=1`,
  coverUrl: (id) => `/covers/${q(id)}`,
};
