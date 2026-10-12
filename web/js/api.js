const KEY = 'audioplayer.token';

export function getToken() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setToken(value) {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

export const auth = { email: '', provider: '' };

export function isSignedIn() {
  return !!(auth.email || getToken());
}

const CSRF = { 'X-Requested-With': 'audioplayer' };

function lostSession() {
  if (!auth.email) return;
  auth.email = '';
  auth.provider = '';
  window.dispatchEvent(new Event('auth-changed'));
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = { ...CSRF };
  if (getToken()) headers['X-API-Token'] = getToken();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Server unreachable');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    let detail = data && data.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join('; ');
    if (res.status === 401) {
      detail = 'Not signed in (see Settings)';
      lostSession();
    }
    if (res.status === 503) detail = 'Server has no AUDIO_API_TOKEN configured';
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return data;
}

const q = (id) => encodeURIComponent(id);
const tokenQuery = () => (auth.email || !getToken() ? '' : `?token=${encodeURIComponent(getToken())}`);

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
  if (!res.ok) throw new ApiError(res.status, (data && data.detail) || `Request failed (${res.status})`);
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
  library: () => request('GET', '/library').then((d) => d.songs),
  tags: () => request('GET', '/tags'),
  preview: (url) => request('POST', '/preview', { url }),
  addSong: (url, metadata, tags) => request('POST', '/songs', { url, metadata, tags }),
  lookupWikipedia: (links) => request('POST', '/lookup/wikipedia', links),
  status: (id) => request('GET', `/songs/${q(id)}/status`),
  patch: (id, changes) => request('PATCH', `/songs/${q(id)}`, changes),
  detectBpm: (id) => request('POST', `/songs/${q(id)}/bpm/detect`),
  remove: (id) => request('DELETE', `/songs/${q(id)}`),
  fileUrl: (id) => `/files/${q(id)}${tokenQuery()}`,
  coverUrl: (id) => `/covers/${q(id)}${tokenQuery()}`,
};
