import { el } from './dom.js';
import { dialogHead } from './edit-dialog.js';
import { playlistStore } from './playlists-store.js';
import { NAME_MAX, DESCRIPTION_MAX, suggestName } from './playlists-model.js';

const NAME_TAKEN = 'playlist_name_taken';

export const plDialog = () => document.getElementById('pl-dialog');

export function openPlDialog(label, ...content) {
  const dlg = plDialog();
  dlg.setAttribute('aria-label', label);
  dlg.replaceChildren(...content);
  if (!dlg.open) dlg.showModal();
  return dlg;
}

export const closePlDialog = () => {
  const dlg = plDialog();
  if (dlg.open) dlg.close();
};

export function playlistForm({ title, sub = null, submit, name = '', description = '', withDescription = true, exceptId = '', onSubmit }) {
  const nameInput = el('input', { id: 'pl-name', type: 'text', maxlength: NAME_MAX, required: true, value: name, autocomplete: 'off' });
  const descInput = withDescription
    ? el('textarea', { id: 'pl-desc', class: 'pl-desc', maxlength: DESCRIPTION_MAX, rows: 3, value: description })
    : null;
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const go = el('button', { type: 'submit', class: 'btn primary glow' }, submit);
  const form = el('form', { method: 'dialog', class: 'pl-form' },
    dialogHead(title, sub, closePlDialog),
    el('div', { class: 'field' }, el('label', { for: 'pl-name' }, 'Name'), nameInput),
    descInput ? el('div', { class: 'field' }, el('label', { for: 'pl-desc' }, 'Description (optional)'), descInput) : null,
    err,
    el('div', { class: 'row end' }, go));
  const fail = (text) => {
    err.textContent = text;
    err.hidden = false;
    go.disabled = false;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const wanted = nameInput.value.trim();
    if (!wanted) { fail('Give the playlist a name.'); nameInput.focus(); return; }
    err.hidden = true;
    go.disabled = true;
    try {
      await onSubmit(wanted, descInput ? descInput.value.trim() : '');
      closePlDialog();
    } catch (ex) {
      if (ex.code === NAME_TAKEN) {
        const next = suggestName(wanted, playlistStore.names(exceptId));
        nameInput.value = next;
        fail(`You already have a playlist named "${wanted}". Use "${next}" or type another name.`);
        nameInput.focus();
        nameInput.select();
        return;
      }
      fail(ex.message);
    }
  });
  const dlg = openPlDialog(title, form);
  nameInput.focus();
  nameInput.select();
  return dlg;
}

export function confirmDeletePlaylist(playlist, onConfirm) {
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const del = el('button', { type: 'submit', class: 'btn danger' }, 'Delete playlist');
  const form = el('form', { method: 'dialog' },
    dialogHead('Delete playlist?', playlist.name, closePlDialog),
    el('p', { class: 't-body' }, 'The songs stay in your library.'),
    err,
    el('div', { class: 'row end' }, del));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    del.disabled = true;
    try {
      await onConfirm();
      closePlDialog();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      del.disabled = false;
    }
  });
  openPlDialog('Delete playlist?', form);
  del.focus();
}
