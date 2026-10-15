import { api } from './api.js';
import { store } from './store.js';
import { el, toast } from './dom.js';

export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function fileProblem(file) {
  if (!file) return 'Choose an image first.';
  if (!COVER_TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP image.';
  if (file.size > COVER_MAX_BYTES) return 'The image is larger than 5 MB.';
  return '';
}

export function urlProblem(text) {
  const t = String(text || '').trim();
  if (!t) return 'Enter an image address.';
  let u;
  try { u = new URL(t); } catch { return 'Enter a full http:// or https:// address.'; }
  return u.protocol === 'http:' || u.protocol === 'https:' ? '' : 'Enter a full http:// or https:// address.';
}

export function coverError(ex) {
  if (ex?.status === 0) return 'Could not reach the server. Try again.';
  if (ex?.status === 413) return 'The image is larger than 5 MB.';
  return ex?.message || 'Could not change the cover.';
}

export function coverEditor(song) {
  const id = song.id;
  const img = el('img', { class: 'cover cover-edit-img', alt: '' });
  const msg = el('p', { class: 't-caption muted', role: 'status' });
  const file = el('input', { type: 'file', accept: COVER_TYPES.join(','), hidden: true, tabindex: '-1' });
  const urlIn = el('input', { type: 'url', placeholder: 'https://...', 'aria-label': 'Image address', autocomplete: 'off' });
  const urlGo = el('button', { type: 'button', class: 'btn outline small' }, 'Use this image');
  const urlRow = el('div', { class: 'cover-url-row', hidden: true }, urlIn, urlGo);
  const menu = el('div', { class: 'cover-menu', role: 'group', 'aria-label': 'Change cover', hidden: true });
  const toggle = el('button', { type: 'button', class: 'btn outline small', 'aria-expanded': 'false' }, 'Change cover');
  const btn = (label, run) => el('button', { type: 'button', class: 'btn outline small', onclick: run }, label);
  const remove = btn('Remove cover', () => apply(() => api.removeCover(id), 'Cover removed'));
  const controls = [toggle, urlGo, urlIn];

  const paint = () => {
    const s = store.get(id) || song;
    if (s.cover) img.src = api.coverUrl(id, s.cover_v); else img.removeAttribute('src');
    img.classList.toggle('noart', !s.cover);
    remove.hidden = !s.cover;
  };
  const busy = (on) => {
    for (const c of [...controls, ...menu.querySelectorAll('button')]) c.disabled = on;
    msg.textContent = on ? 'Working...' : msg.textContent;
  };
  const setMenu = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (!open) urlRow.hidden = true;
  };
  async function apply(run, done) {
    busy(true);
    try {
      await run();
      await store.refresh();
      msg.textContent = done;
      toast(done);
      setMenu(false);
      urlIn.value = '';
      paint();
    } catch (ex) {
      msg.textContent = coverError(ex);
    } finally {
      busy(false);
    }
  }

  toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); e.preventDefault(); setMenu(false); toggle.focus(); }
  });
  menu.append(
    btn('Upload file', () => file.click()),
    btn('From address', () => { urlRow.hidden = false; urlIn.focus(); }),
    remove);
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    const bad = fileProblem(f);
    if (bad) { msg.textContent = bad; return; }
    apply(() => api.uploadCover(id, f), 'Cover updated');
  });
  const submitUrl = () => {
    const bad = urlProblem(urlIn.value);
    if (bad) { msg.textContent = bad; urlIn.focus(); return; }
    apply(() => api.coverFromUrl(id, urlIn.value.trim()), 'Cover updated');
  };
  urlGo.addEventListener('click', submitUrl);
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitUrl(); } });
  const unsub = store.subscribe(paint);
  paint();
  const node = el('div', { class: 'cover-edit' }, img,
    el('div', { class: 'cover-edit-body' }, toggle, menu, urlRow, msg, file));
  return { node, destroy: unsub };
}
