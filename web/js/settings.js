import { auth, getToken, setToken, session } from './api.js';
import { store } from './store.js';
import { el, pageHead } from './dom.js';

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
    out.replaceChildren(el('p', { class: 'msg error' }, ex.status === 403 ? 'This account is not the owner.' : ex.message));
  }
}

async function setupProviders(box, out) {
  let cfg;
  try { cfg = await session.config(); } catch (ex) {
    box.replaceChildren(el('p', { class: 'msg error' }, ex.message));
    return;
  }
  box.replaceChildren();
  if (cfg.google_client_id) {
    const slot = el('div', { class: 'signin-slot' });
    box.append(slot);
    loadScript(GSI).then(() => {
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: (r) => finish(r.credential, out),
      });
      window.google.accounts.id.renderButton(slot, { theme: 'outline', size: 'large', text: 'signin_with', width: 260 });
    }).catch((ex) => slot.replaceChildren(el('p', { class: 'msg error' }, ex.message)));
  }
  if (cfg.apple_client_id) {
    const btn = el('button', { class: 'btn apple-btn', type: 'button', disabled: true }, ' Sign in with Apple');
    box.append(btn);
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
    box.append(el('p', { class: 'muted t-subhead' }, 'Sign-in is not configured on the server. Use the API token below.'));
  }
}

function renderAccount() {
  const out = el('div');
  if (auth.email) {
    return el('div', { class: 'card' },
      el('p', { class: 'signed-as t-body' }, 'Signed in as ', el('b', {}, auth.email)),
      el('div', { class: 'row', style: 'margin-top:16px' },
        el('button', {
          class: 'btn',
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
  const card = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, 'Sign in (owner only)'), box, out);
  setupProviders(box, out);
  return card;
}

export function renderSettings(root) {
  const input = el('input', { type: 'password', value: getToken(), autocomplete: 'off', placeholder: 'API token', 'aria-label': 'API token' });
  const out = el('div');
  const form = el('form', { class: 'card' },
    el('label', { class: 'first' }, 'API token (fallback; same value as AUDIO_API_TOKEN on the server)'),
    input,
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'btn primary', type: 'submit' }, 'Save and test'),
      el('button', { class: 'btn', type: 'button', onclick: () => { setToken(''); input.value = ''; out.replaceChildren(el('p', { class: 'msg' }, 'Token cleared.')); window.dispatchEvent(new Event('auth-changed')); } }, 'Clear')),
    out,
    el('p', { class: 'muted t-subhead' }, 'The token is stored in this browser only (localStorage) and sent as X-API-Token. Signing in above uses a session cookie instead and keeps tokens out of URLs.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setToken(input.value.trim());
    try {
      await store.refresh();
      out.replaceChildren(el('p', { class: 'msg ok' }, `Connected. ${store.songs.length} songs in library.`));
      window.dispatchEvent(new Event('auth-changed'));
    } catch (ex) {
      out.replaceChildren(el('p', { class: 'msg error' }, ex.message));
    }
  });
  root.append(pageHead('Settings'), renderAccount(), form);
}
