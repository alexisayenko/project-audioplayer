import { session } from './api.js';
import { store } from './store.js';
import { el } from './dom.js';
import { signInErrorText } from './signin-error.js';
import { serviceIcon } from './service-icons.js';

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

async function finish(idToken, out, keepHash) {
  try {
    await session.start(idToken);
    if (keepHash) {
      await store.refresh().catch(() => {});
      window.dispatchEvent(new Event('auth-changed'));
      return;
    }
    window.dispatchEvent(new Event('auth-changed'));
    await store.refresh();
    location.hash = '#/library';
  } catch (ex) {
    out.replaceChildren(el('p', { class: 'msg error' }, ex.message));
  }
}

export async function setupProviders(box, out, { keepHash = false } = {}) {
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
        callback: (r) => finish(r.credential, out, keepHash),
      });
      window.google.accounts.id.renderButton(slot, { theme: 'outline', size: 'medium', text: 'signin', shape: 'pill' });
    }).catch((ex) => slot.replaceChildren(el('p', { class: 'msg error' }, ex.message)));
  }
  if (cfg.apple_client_id) {
    const btn = el('button', { class: 'btn outline', type: 'button', disabled: true }, serviceIcon('apple', { size: 'inline' }), 'Sign in');
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
          await finish(r.authorization.id_token, out, keepHash);
        } catch (ex) {
          if (ex && ex.error !== 'popup_closed_by_user') out.replaceChildren(el('p', { class: 'msg error' }, signInErrorText('Apple', ex, location.origin)));
        }
      });
    }).catch((ex) => btn.replaceWith(el('p', { class: 'msg error' }, ex.message)));
  }
  if (!cfg.google_client_id && !cfg.apple_client_id) {
    box.append(el('p', { class: 'muted t-subhead' }, 'Sign-in is not configured on the server.'));
  }
}
