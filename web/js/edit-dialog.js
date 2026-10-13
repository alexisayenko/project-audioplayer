import { api } from './api.js';
import { store } from './store.js';
import { el, toast, field, clearable } from './dom.js';
import { tagEditor } from './tag-editor.js';
import { chipField } from './chip-field.js';
import { wikiFields } from './wiki-links.js';

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
  const f = {
    title: el('input', { type: 'text', value: song.title || '', required: true }),
    artist: el('input', { type: 'text', value: song.artist || '' }),
    album: el('input', { type: 'text', value: song.album || '' }),
    remixer: el('input', { type: 'text', value: song.remixer || '' }),
    year: el('input', { type: 'number', value: song.year ?? '', min: 0, max: 3000 }),
    bpm: el('input', { type: 'number', value: song.bpm != null ? Math.round(song.bpm) : '', min: 20, max: 300, step: 1, placeholder: 'Unknown' }),
  };
  const editor = tagEditor({ tags: song.tags || [], year: f.year, hideNs: true });
  const genres = chipField('genre', editor);
  const countries = chipField('country', editor);
  const err = el('p', { class: 'msg error', hidden: true });
  const wiki = wikiFields({
    song: song.wikipedia_song, artist: song.wikipedia_artist,
  });
  const redetect = el('button', { type: 'button', class: 'btn outline small' }, 'Re-detect');
  redetect.addEventListener('click', async () => {
    redetect.disabled = true;
    redetect.textContent = 'Detecting...';
    try {
      const updated = await api.detectBpm(song.id);
      f.bpm.value = updated.bpm != null ? Math.round(updated.bpm) : '';
      err.hidden = true;
      await store.refresh();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      redetect.disabled = false;
      redetect.textContent = 'Re-detect';
    }
  });
  const form = el('form', { method: 'dialog' },
    dialogHead('Edit song', null, () => dlg.close()),
    field('Title', f.title), field('Artist', f.artist),
    field('Remix & additional production', f.remixer),
    el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
    el('div', { class: 'field' }, el('label', {}, 'BPM (heuristic, may be off by half or double)'), el('div', { class: 'row' }, clearable(f.bpm, 'BPM'), redetect)),
    wiki.node,
    genres.node, countries.node,
    el('div', { class: 'field' }, el('label', {}, 'Tags'), editor.node),
    err,
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn danger del-left', onclick: () => removeSong(song) }, 'Delete from library'),
      el('button', { type: 'submit', class: 'btn primary glow' }, 'Save')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    genres.commit();
    countries.commit();
    try {
      await api.patch(song.id, {
        title: f.title.value,
        artist: f.artist.value,
        album: f.album.value,
        remixer: f.remixer.value,
        year: f.year.value === '' ? null : Number(f.year.value),
        bpm: f.bpm.value === '' ? null : Math.round(Number(f.bpm.value)),
        tags: editor.getTags(),
        ...wiki.values(),
      });
      dlg.close();
      await store.refresh();
      toast('Saved');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}
