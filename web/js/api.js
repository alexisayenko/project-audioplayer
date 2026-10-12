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

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = { 'X-API-Token': getToken() };
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
    if (res.status === 401) detail = 'Wrong or missing API token (see Settings)';
    if (res.status === 503) detail = 'Server has no AUDIO_API_TOKEN configured';
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return data;
}

const q = (id) => encodeURIComponent(id);
const tokenQuery = () => `?token=${encodeURIComponent(getToken())}`;

export const api = {
  library: () => request('GET', '/library').then((d) => d.songs),
  tags: () => request('GET', '/tags'),
  preview: (url) => request('POST', '/preview', { url }),
  addSong: (url, metadata, tags) => request('POST', '/songs', { url, metadata, tags }),
  status: (id) => request('GET', `/songs/${q(id)}/status`),
  patch: (id, changes) => request('PATCH', `/songs/${q(id)}`, changes),
  remove: (id) => request('DELETE', `/songs/${q(id)}`),
  fileUrl: (id) => `/files/${q(id)}${tokenQuery()}`,
  coverUrl: (id) => `/covers/${q(id)}${tokenQuery()}`,
};
