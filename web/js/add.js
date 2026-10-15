import { api } from './api.js';
import { autodl, autoDownloadOn } from './autodl.js';
import { store } from './store.js';
import { el, fmtTime, toast } from './dom.js';
import { icon } from './icons.js';
import { cleanPasted, sourceOf, sourceLabel } from './url-clean.js';
import { findInLibrary } from './library-match.js';
import { dialogHead } from './edit-dialog.js';
import { songForm } from './song-form.js';
import { ADD_ROW_OUTLINE_MS } from './constants.js';
import { addBody, yearError } from './song-payload.js';
import { can } from './guest.js';

const BULK = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertReplacementText']);
const PREVIEW_ONLY = 'Preview only \u2014 SoundCloud Go+ track, can\'t be downloaded in full.';

export function openAdd() {
  if (!can('add')) return;
  const dlg = document.getElementById('add-dialog');
  let preview = null;
  let sf = null;
  let gen = 0;
  const pending = new Set();
  const begin = () => {
    const ctl = new AbortController();
    pending.add(ctl);
    const mine = gen;
    return { signal: ctl.signal, live: () => mine === gen && dlg.open, done: () => pending.delete(ctl) };
  };

  const url = el('input', { type: 'text', placeholder: 'YouTube or SoundCloud link, or a YouTube video id', 'aria-label': 'YouTube or SoundCloud link, or a YouTube video id', autocomplete: 'off', inputMode: 'url' });
  const fetchBtn = el('button', { class: 'btn fill small', type: 'submit' }, 'Fetch');
  const form = el('form', { class: 'well' }, url, fetchBtn);
  const known = el('div', { class: 't-caption', role: 'status' });
  const message = el('div');
  const body = el('div', { class: 'add-body' });
  const say = (text, kind = '') => message.replaceChildren(text ? el('p', { class: `msg ${kind}` }, text) : '');

  const tidy = () => {
    const clean = cleanPasted(url.value);
    if (clean === url.value) return;
    url.value = clean;
    checkKnown();
    url.setSelectionRange(clean.length, clean.length);
  };
  const showInLibrary = (song) => {
    dlg.close();
    const row = document.querySelector(`li.song[data-id="${CSS.escape(song.id)}"]`);
    if (!row) { toast('Clear the search or filters to see it'); return; }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.style.outline = '2px solid var(--accent-ink)';
    setTimeout(() => { row.style.outline = ''; }, ADD_ROW_OUTLINE_MS);
  };
  const checkKnown = () => {
    const song = store.loaded ? findInLibrary(url.value, store.songs) : null;
    fetchBtn.disabled = !!song;
    if (!song) { known.replaceChildren(); return; }
    const where = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Show in library');
    where.addEventListener('click', () => showInLibrary(song));
    known.replaceChildren(icon('check', 16), ` Already in your library: ${[song.title, song.artist].filter(Boolean).join(' · ')} `, where);
  };
  url.addEventListener('input', checkKnown);
  url.addEventListener('input', (e) => { if (BULK.has(e.inputType) || (e.data && e.data.length > 1)) tidy(); });
  url.addEventListener('paste', () => setTimeout(tidy));
  url.addEventListener('drop', () => setTimeout(tidy));
  url.addEventListener('blur', tidy);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    tidy();
    if (!url.value || fetchBtn.disabled) return;
    say('');
    body.replaceChildren();
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';
    const req = begin();
    try {
      const got = await api.preview(url.value, req.signal);
      if (!req.live()) return;
      if (!store.loaded) await store.refresh().catch(() => {});
      if (!req.live()) return;
      preview = got;
      form.hidden = true;
      renderPreview();
      if (preview.in_library) say('This song is already in your library.', 'error');
    } catch (ex) {
      if (!req.live()) return;
      say(ex.code === 'preview_only' ? PREVIEW_ONLY : ex.message, 'error');
    } finally {
      req.done();
      if (req.live()) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch';
        checkKnown();
      }
    }
  });

  function renderPreview() {
    if (sf) sf.destroy();
    sf = songForm({
      mode: 'add',
      song: { ...preview, wikipedia_song: preview.wikipedia_song, wikipedia_artist: preview.wikipedia_artist, wikipedia_album: preview.wikipedia_album },
      source: () => preview?.source_url || null,
    });

    const cover = el('img', { class: 'cover xl', alt: '', src: preview.thumbnail });
    cover.addEventListener('error', () => cover.removeAttribute('src'));
    const title = el('div', { class: 't-headline' });
    const sub = el('div', { class: 't-subhead muted' });
    const facts = el('div', { class: 't-time muted' });
    const paintMeta = () => {
      const v = sf.values({ commit: false });
      title.textContent = v.title || 'Untitled';
      sub.textContent = [v.artist, v.album, v.year].filter(Boolean).join(' \u00b7 ');
      facts.textContent = preview.duration ? fmtTime(preview.duration) : '';
    };
    sf.node.addEventListener('input', paintMeta);
    paintMeta();

    const save = el('button', { class: 'btn primary glow big', type: 'submit', disabled: !!preview.in_library }, icon('plus', 20), 'Save to library');
    const err = el('div');

    const card = el('form', { class: 'add-card' },
      el('div', { class: 'preview-row' }, cover, el('div', { class: 'preview-meta' }, title, sub, facts,
        el('span', { class: 'chip tint', title: 'Source' }, sourceLabel(preview.source || sourceOf(preview.id))))),
      sf.node,
      err,
      el('div', { class: 'add-foot' }, save));
    body.replaceChildren(card);

    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = sf.values();
      const bad = yearError(v);
      if (bad) {
        err.replaceChildren(el('p', { class: 'msg error' }, bad));
        return;
      }
      const badLink = sf.linkProblems();
      if (badLink) {
        err.replaceChildren(el('p', { class: 'msg error' }, badLink));
        return;
      }
      save.disabled = true;
      try {
        const added = await api.addSong(preview.source_url, addBody(v), v.tags, v.keep_title);
        await store.refresh().catch(() => {});
        if (autoDownloadOn() && added?.id) autodl.request([added.id], { front: true });
        dlg.close();
        toast('Saved to library');
      } catch (ex) {
        save.disabled = !!preview.in_library;
        err.replaceChildren(el('p', { class: 'msg error' }, ex.message));
      }
    });
  }

  dlg.onclose = () => {
    gen += 1;
    for (const ctl of pending) ctl.abort();
    pending.clear();
    preview = null;
    if (sf) sf.destroy();
    sf = null;
    dlg.replaceChildren();
    dlg.onclose = null;
    dlg.onclick = null;
  };
  dlg.replaceChildren(
    dialogHead('Add from YouTube or SoundCloud', 'Save the song\'s details; play it from the original link or on your iPhone.', () => dlg.close()),
    form, known, message, body);
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  url.focus();
  if (!store.loaded) store.refresh().then(checkKnown).catch(() => {});
}
