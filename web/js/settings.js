import { api, auth, getToken, setToken, session } from './api.js';
import { usageText } from './limits.js';
import { store } from './store.js';
import { el, pageHead } from './dom.js';
import { icon } from './icons.js';

const GSI = 'https://accounts.google.com/gsi/client';
const APPLE = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

const loading = new Map();
function loadScript(src) {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const s = el('script', { src, async: true });
      s.onload = resolve;
      s.onerror = () => { loading.delete(src); reject(new Error(`Could not load ${new URL(src).hostname}`)); };
      document.head.append(s);
    }));
  }
  return loading.get(src);
}

async function finish(idToken, out) {
  try {
    await session.start(idToken);
    window.dispatchEvent(new Event('auth-changed'));
    await store.refresh();
    location.hash = '#/library';
  } catch (ex) {
    out.replaceChildren(el('p', { class: 'msg error' }, ex.message));
  }
}

async function setupProviders(box, out) {
  let cfg;
  try { cfg = await session.config(); } catch (ex) {
    box.replaceChildren(el('p', { class: 'msg error' }, ex.message));
    return;
  }
  box.replaceChildren();
  const row = (label, control) => el('div', { class: 'cell' }, el('span', { class: 't-subhead' }, label), control);
  if (cfg.google_client_id) {
    const slot = el('div', { class: 'signin-slot' });
    box.append(row('Sign in with Google', slot));
    loadScript(GSI).then(() => {
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: (r) => finish(r.credential, out),
      });
      window.google.accounts.id.renderButton(slot, { theme: 'outline', size: 'medium', text: 'signin', shape: 'pill' });
    }).catch((ex) => slot.replaceChildren(el('p', { class: 'msg error' }, ex.message)));
  }
  if (cfg.apple_client_id) {
    const btn = el('button', { class: 'btn outline small', type: 'button', disabled: true }, 'Sign in');
    box.append(row('Sign in with Apple', btn));
    loadScript(APPLE).then(() => {
      window.AppleID.auth.init({
        clientId: cfg.apple_client_id,
        scope: 'email',
        redirectURI: cfg.apple_redirect,
        usePopup: true,
      });
      btn.disabled = false;
      btn.addEventListener('click', async () => {
        try {
          const r = await window.AppleID.auth.signIn();
          await finish(r.authorization.id_token, out);
        } catch (ex) {
          if (ex && ex.error !== 'popup_closed_by_user') out.replaceChildren(el('p', { class: 'msg error' }, 'Apple sign-in failed.'));
        }
      });
    }).catch((ex) => btn.replaceWith(el('p', { class: 'msg error' }, ex.message)));
  }
  if (!cfg.google_client_id && !cfg.apple_client_id) {
    box.append(el('p', { class: 'muted t-subhead' }, 'Sign-in is not configured on the server. Use the API token above.'));
  }
}

function accountSection() {
  const out = el('div');
  if (auth.email) {
    return el('div', { class: 'account' },
      el('div', { class: 'cell' },
        el('span', { class: 't-subhead' }, 'Signed in as ', el('b', {}, auth.email)),
        el('button', {
          class: 'btn outline small',
          type: 'button',
          onclick: async () => {
            try { await session.end(); } catch { /* cookie expires on its own */ }
            store.songs = [];
            store.loaded = false;
            window.dispatchEvent(new Event('auth-changed'));
          },
        }, 'Sign out')));
  }
  const box = el('div', { class: 'signin-box' });
  setupProviders(box, out);
  return el('div', { class: 'account' }, box, out);
}

function serverCard() {
  const url = el('input', { id: 's-url', type: 'url', value: location.origin, readOnly: true, 'aria-label': 'Server URL' });
  const input = el('input', { id: 's-tok', type: 'password', value: getToken(), autocomplete: 'off', placeholder: 'Optional when signed in', 'aria-label': 'API token' });
  const eye = el('button', { class: 'eye', type: 'button', 'aria-label': 'Show token', 'aria-pressed': 'false' }, icon('eye', 18));
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
  });
  const out = el('p', { class: 'status t-caption', role: 'status' });
  const test = el('button', { class: 'btn quiet small', type: 'submit' }, 'Test connection');
  const clear = el('button', { class: 'link-btn t-subhead', type: 'button' }, 'Clear token');
  const say = (ok, text) => out.replaceChildren(el('span', { class: `dot${ok ? '' : ' down'}` }), text);
  const form = el('form', { class: 'card' },
    el('h2', { class: 't-headline' }, 'Server'),
    el('div', { class: 'field' }, el('label', { for: 's-url' }, 'Server URL'), url),
    el('div', { class: 'field' }, el('label', { for: 's-tok' }, 'API token (fallback; same value as AUDIO_API_TOKEN on the server)'),
      el('div', { class: 'well' }, input, eye)),
    el('div', { class: 'cell wrap' }, el('div', { class: 'row' }, test, clear), out),
    el('p', { class: 'muted t-caption' }, 'The token is stored in this browser only (localStorage) and sent as X-API-Token. Signing in below uses a session cookie instead and keeps tokens out of URLs.'),
    el('div', { class: 'divider' }),
    accountSection());
  clear.addEventListener('click', () => { setToken(''); input.value = ''; say(false, 'Token cleared'); window.dispatchEvent(new Event('auth-changed')); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setToken(input.value.trim());
    test.disabled = true;
    const t0 = performance.now();
    try {
      await store.refresh();
      say(true, `Connected · ${Math.round(performance.now() - t0)} ms · ${store.songs.length} songs`);
      window.dispatchEvent(new Event('auth-changed'));
    } catch (ex) {
      say(false, ex.message);
    } finally {
      test.disabled = false;
    }
  });
  return form;
}

function libraryCard() {
  const songs = store.songs.length;
  const secs = store.songs.reduce((n, s) => n + (s.duration || 0), 0);
  const hours = secs >= 3600 ? `${(secs / 3600).toFixed(1)} h of music` : `${Math.round(secs / 60)} min of music`;
  const meter = el('span', { class: 't-caption' }, '');
  api.usage().then((u) => { meter.textContent = usageText(u); }).catch(() => { meter.textContent = ''; });
  const sync = el('span', {}, 'Checking...');
  fetch('/health').then((r) => r.json()).then((h) => {
    sync.textContent = h.sync === 'ok' ? 'In sync with git' : h.sync === 'error' ? 'Not reaching git (retrying)' : 'Waiting to sync to git';
  }).catch(() => { sync.textContent = 'Server unreachable'; });
  return el('section', { class: 'card' },
    el('h2', { class: 't-headline' }, 'Library on the server'),
    el('div', { class: 'cell' },
      el('span', { class: 't-title' }, `${songs} ${songs === 1 ? 'song' : 'songs'}`),
      el('span', { class: 'muted t-caption' }, songs ? hours : '')),
    el('div', { class: 'divider' }),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Storage'), meter),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Sync'), el('span', { class: 't-caption' }, sync)),
    el('div', { class: 'cell' }, el('span', { class: 'muted t-caption' }, 'Server'), el('span', { class: 't-caption' }, location.host)));
}

export function renderSettings(root) {
  let card = libraryCard();
  const unsub = store.subscribe(() => { const next = libraryCard(); card.replaceWith(next); card = next; });
  root.append(pageHead('Settings', 'Your library and storage on this server.'), el('div', { class: 'settings-grid' }, serverCard(), ...(auth.email || getToken() ? [card] : [])));
  return unsub;
}
