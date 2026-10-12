import { api, getToken, setToken } from './api.js';
import { store } from './store.js';
import { el } from './dom.js';

export function renderSettings(root) {
  const input = el('input', { type: 'password', value: getToken(), autocomplete: 'off', placeholder: 'API token', 'aria-label': 'API token' });
  const out = el('div');
  const form = el('form', { class: 'card' },
    el('label', { style: 'margin-top:0' }, 'API token (same value as AUDIO_API_TOKEN on the server)'),
    input,
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { class: 'btn primary', type: 'submit' }, 'Save and test'),
      el('button', { class: 'btn', type: 'button', onclick: () => { setToken(''); input.value = ''; out.replaceChildren(el('p', { class: 'msg' }, 'Token cleared.')); } }, 'Clear')),
    out,
    el('p', { class: 'muted' }, 'The token is stored in this browser only (localStorage) and sent as X-API-Token. Audio and covers use it as a ?token= query parameter.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setToken(input.value.trim());
    try {
      await store.refresh();
      out.replaceChildren(el('p', { class: 'msg ok' }, `Connected. ${store.songs.length} songs in library.`));
    } catch (ex) {
      out.replaceChildren(el('p', { class: 'msg error' }, ex.message));
    }
  });
  root.append(form);
}
