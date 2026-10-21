import { el } from './dom.js';
import { icon } from './icons.js';
import { setupProviders } from './signin.js';

export function renderLogin(root) {
  const box = el('div', { class: 'signin-box' });
  const out = el('div', { role: 'status' });
  void setupProviders(box, out, { keepHash: true });
  root.append(el('section', { class: 'login card', 'aria-labelledby': 'login-title' },
    el('div', { class: 'login-brand' }, icon('mark'), el('h1', { id: 'login-title', class: 't-display' }, 'Electrophone')),
    el('p', { class: 'muted t-subhead' }, 'Sign in to see your library, add songs and play them.'),
    box, out));
  return null;
}
