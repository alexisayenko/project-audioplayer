import { api } from './api.js';
import { autodl, autoDownloadOn } from './autodl.js';
import { store } from './store.js';
import { el, fmtTime, toast } from './dom.js';
import { icon } from './icons.js';
import { sourceOf, sourceLabel } from './url-clean.js';
import { addBody, yearError, artistString, storedTags } from './song-payload.js';

export function hitRow(hit, onPick) {
  const cover = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (hit.thumbnail) cover.src = hit.thumbnail;
  cover.addEventListener('error', () => cover.removeAttribute('src'));
  return el('li', {},
    el('button', { class: 'add-hit', type: 'button', onclick: () => onPick(hit) },
      cover,
      el('span', { class: 'add-hit-info' },
        el('span', { class: 'add-hit-title t-subhead' }, hit.title || 'Untitled'),
        el('span', { class: 'add-hit-sub t-caption muted' }, hit.artist || '')),
      hit.duration ? el('span', { class: 'add-hit-dur t-time muted' }, fmtTime(hit.duration)) : null));
}

export function previewCard({ preview, sf, dlg, onSaved }) {
  const cover = el('img', { class: 'cover xl', alt: '', src: preview.thumbnail });
  cover.addEventListener('error', () => cover.removeAttribute('src'));
  const title = el('div', { class: 't-headline' });
  const sub = el('div', { class: 't-subhead muted' });
  const albumLine = el('div', { class: 't-subhead muted' });
  const facts = el('div', { class: 't-time muted' });
  const paintMeta = () => {
    const v = sf.values({ commit: false });
    title.textContent = v.title || 'Untitled';
    sub.textContent = [artistString(v), v.releaseYear].filter(Boolean).join(' · ');
    albumLine.textContent = v.albums?.[0] || '';
    albumLine.hidden = !v.albums?.[0];
    facts.textContent = preview.duration ? fmtTime(preview.duration) : '';
  };
  sf.node.addEventListener('input', paintMeta);
  paintMeta();

  const save = el('button', { class: 'btn primary glow big', type: 'submit', disabled: !!preview.in_library }, icon('plus', 'nav'), 'Save to library');
  const err = el('div');

  const card = el('form', { class: 'add-card' },
    el('div', { class: 'preview-row' }, cover, el('div', { class: 'preview-meta' }, title, sub, albumLine, facts,
      el('span', { class: 'chip tint', title: 'Source' }, sourceLabel(preview.source || sourceOf(preview.id))))),
    sf.node,
    err,
    el('div', { class: 'add-foot' }, save));

  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = sf.values();
    const problem = yearError(v) || sf.linkProblems() || sf.trimProblem();
    if (problem) {
      err.replaceChildren(el('p', { class: 'msg error' }, problem));
      return;
    }
    save.disabled = true;
    try {
      const added = await api.addSong(preview.source_url, addBody(v), storedTags(v.tags), v.keep_title, preview.raw ?? null, sf.trimValue());
      if (added?.song && store.loaded) store.insert(added.song); else await store.refresh().catch(() => {});
      if (autoDownloadOn() && added?.id) autodl.request([added.id], { front: true });
      dlg.close();
      toast('Saved to library');
      onSaved?.(added);
    } catch (ex) {
      save.disabled = !!preview.in_library;
      err.replaceChildren(el('p', { class: 'msg error' }, sf.saveError(ex) || ex.message));
    }
  });
  return card;
}
