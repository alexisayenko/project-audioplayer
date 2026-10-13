import { api } from './api.js';
import { store } from './store.js';
import { el, toast } from './dom.js';
import { songForm } from './song-form.js';
import { patchBody, songSources } from './song-payload.js';

export function dialogHead(title, sub, onCancel) {
  return el('div', { class: 'dlg-head' },
    el('div', {}, el('h2', { class: 't-title' }, title), sub ? el('p', { class: 'muted t-caption' }, sub) : null),
    el('button', { type: 'button', class: 'link-btn t-headline', onclick: onCancel }, 'Cancel'));
}

export function removeSong(s) {
  const dlg = document.getElementById('edit-dialog');
  const err = el('p', { class: 'msg error', hidden: true });
  const del = el('button', { type: 'submit', class: 'btn danger' }, 'Delete from library');
  const form = el('form', { method: 'dialog' },
    dialogHead('Delete song?', null, () => dlg.close()),
    el('p', { class: 't-body' }, `"${s.title}" will be removed from the library. The audio file and cover are deleted from the server.`),
    err,
    el('div', { class: 'row end' }, del));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    del.disabled = true;
    try {
      await api.remove(s.id);
      dlg.close();
      await store.refresh();
      toast('Deleted');
    } catch (ex) {
      if (ex.status === 404) {
        dlg.close();
        await store.refresh().catch(() => {});
        return;
      }
      err.textContent = ex.message;
      err.hidden = false;
      del.disabled = false;
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
  del.focus();
}

export function editDialog(song) {
  const dlg = document.getElementById('edit-dialog');
  const sf = songForm({ mode: 'edit', song, source: () => songSources(song) });
  const err = el('p', { class: 'msg error', hidden: true });
  const form = el('form', { method: 'dialog' },
    dialogHead('Edit song', null, () => dlg.close()),
    sf.node,
    err,
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn danger del-left', onclick: () => removeSong(song) }, 'Delete from library'),
      el('button', { type: 'submit', class: 'btn primary glow' }, 'Save')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = sf.values();
    if (!v.title.trim()) {
      err.textContent = 'Title is required';
      err.hidden = false;
      sf.focus();
      return;
    }
    try {
      await api.patch(song.id, patchBody(v));
      dlg.close();
      await store.refresh();
      toast('Saved');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  dlg.addEventListener('close', () => sf.destroy(), { once: true });
  dlg.replaceChildren(form);
  dlg.showModal();
}
