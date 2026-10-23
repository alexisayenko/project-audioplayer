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
import { addBody, yearError, artistString, storedTags } from './song-payload.js';
import { displayLine } from './credits.js';
import { can } from './guest.js';
import { fetchSteps } from './add-progress.js';
import { playlistLink, watchUrl, MIX_MESSAGE, PRIVATE_MESSAGE } from './playlist-link.js';
import { playlistImport } from './playlist-import.js';
import { addPlan } from './drafts-model.js';

const BULK = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertReplacementText']);
const PREVIEW_ONLY = 'Preview only \u2014 SoundCloud Go+ track, can\'t be downloaded in full.';

export function openAdd(opts) {
  if (!can('add')) return;
  const draft = opts?.draft ?? null;
  const plan = draft ? addPlan(draft) : opts?.url ? { url: opts.url, credits: null, note: opts.note || '' } : null;
  const query = !plan && typeof opts?.query === 'string' ? opts.query.trim() : '';
  const note = plan?.note ?? (query ? opts.note || '' : '');
  const dlg = document.getElementById('add-dialog');
  let preview = null;
  let sf = null;
  let gen = 0;
  let steps = null;
  let imp = null;
  const pending = new Set();
  const begin = () => {
    const ctl = new AbortController();
    pending.add(ctl);
    const mine = gen;
    return { signal: ctl.signal, live: () => mine === gen && dlg.open, done: () => pending.delete(ctl) };
  };

  const url = el('input', { type: 'text', placeholder: 'YouTube or SoundCloud link, a YouTube playlist, or a video id', 'aria-label': 'YouTube or SoundCloud link, a YouTube playlist link, or a YouTube video id', autocomplete: 'off', inputMode: 'url' });
  const fetchBtn = el('button', { class: 'btn fill small', type: 'submit' }, 'Fetch');
  const form = el('form', { class: 'well' }, url, fetchBtn);
  const known = el('div', { class: 't-caption', role: 'status' });
  const message = el('div');
  const body = el('div', { class: 'add-body' });
  const say = (text, kind = '') => message.replaceChildren(text ? el('p', { class: `msg ${kind}` }, text) : '');

  const cleanedUrl = () => {
    const list = playlistLink(url.value);
    if (!list) return cleanPasted(url.value);
    return list.kind === 'playlist' && !list.video ? list.url : url.value;
  };
  const tidy = () => {
    const clean = cleanedUrl();
    if (clean === url.value) return;
    url.value = clean;
    checkKnown();
    url.setSelectionRange(clean.length, clean.length);
  };
  const showInLibrary = (song) => {
    dlg.close();
    const row = document.querySelector(`li.song[data-id="${CSS.escape(song.id)}"]`);
    if (!row) { toast('Clear the search or filters to see it'); return; }
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), ADD_ROW_OUTLINE_MS);
  };
  const checkKnown = () => {
    const song = store.loaded && !playlistLink(url.value) ? findInLibrary(url.value, store.songs) : null;
    fetchBtn.disabled = !!song;
    if (!song) { known.replaceChildren(); return; }
    const where = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Show in library');
    where.addEventListener('click', () => showInLibrary(song));
    known.replaceChildren(icon('check', 'inline'), ` Already in your library: ${displayLine(song)} `, where);
  };
  url.addEventListener('input', checkKnown);
  url.addEventListener('input', (e) => { if (BULK.has(e.inputType) || (e.data && e.data.length > 1)) tidy(); });
  url.addEventListener('paste', () => setTimeout(tidy));
  url.addEventListener('drop', () => setTimeout(tidy));
  url.addEventListener('blur', tidy);

  async function runPreview() {
    body.replaceChildren();
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';
    const req = begin();
    steps = fetchSteps();
    const mine = steps;
    body.replaceChildren(mine.node);
    try {
      const got = await api.preview(url.value, req.signal, (ev) => { if (req.live()) mine.handle(ev); });
      if (!req.live()) return;
      if (!store.loaded) await store.refresh().catch(() => {});
      if (!req.live()) return;
      mine.stop();
      preview = got;
      form.hidden = true;
      renderPreview();
      if (preview.in_library) say('This song is already in your library.', 'error');
    } catch (ex) {
      if (!req.live()) return;
      mine.fail();
      say(ex.code === 'preview_only' ? PREVIEW_ONLY : ex.message, 'error');
    } finally {
      mine.stop();
      req.done();
      if (req.live()) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch';
        checkKnown();
      }
    }
  }

  function pickHit(hit) {
    body.replaceChildren();
    say('');
    url.value = watchUrl(hit.id);
    checkKnown();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  function hitRow(hit) {
    const cover = el('img', { class: 'cover', alt: '', loading: 'lazy' });
    if (hit.thumbnail) cover.src = hit.thumbnail;
    cover.addEventListener('error', () => cover.removeAttribute('src'));
    return el('li', {},
      el('button', { class: 'add-hit', type: 'button', onclick: () => pickHit(hit) },
        cover,
        el('span', { class: 'add-hit-info' },
          el('span', { class: 'add-hit-title t-subhead' }, hit.title || 'Untitled'),
          el('span', { class: 'add-hit-sub t-caption muted' }, hit.artist || '')),
        hit.duration ? el('span', { class: 'add-hit-dur t-time muted' }, fmtTime(hit.duration)) : null));
  }

  async function runSearch(text) {
    const req = begin();
    body.replaceChildren(el('p', { class: 'add-hits-status t-caption muted', role: 'status' }, `Searching YouTube for "${text}"...`));
    try {
      const hits = await api.search(text, req.signal);
      if (!req.live()) return;
      body.replaceChildren(hits?.length
        ? el('ul', { class: 'add-hits', 'aria-label': `YouTube results for ${text}` }, ...hits.map(hitRow))
        : el('p', { class: 'add-hits-status t-caption muted' }, 'No YouTube results. Paste a link above.'));
    } catch (ex) {
      if (!req.live()) return;
      body.replaceChildren();
      say(ex.message, 'error');
    } finally {
      req.done();
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    tidy();
    if (!url.value || fetchBtn.disabled) return;
    say('');
    const list = playlistLink(url.value);
    if (list) {
      if (list.kind === 'playlist') startImport(list);
      else say(list.kind === 'mix' ? MIX_MESSAGE : PRIVATE_MESSAGE, 'error');
      return;
    }
    await runPreview();
  });

  function leaveImport() {
    if (imp) imp.destroy();
    imp = null;
    dlg.classList.remove('import');
    body.replaceChildren();
    say('');
    form.hidden = false;
    checkKnown();
  }
  function startImport(list) {
    body.replaceChildren();
    form.hidden = true;
    dlg.classList.add('import');
    const video = list.video;
    imp = playlistImport({
      link: list,
      onBack: () => { leaveImport(); url.focus(); },
      onSingle: video ? () => { leaveImport(); url.value = watchUrl(video); checkKnown(); form.dispatchEvent(new Event('submit', { cancelable: true })); } : null,
    });
    body.replaceChildren(imp.node);
  }

  function renderPreview() {
    if (sf) sf.destroy();
    sf = songForm({
      mode: 'add',
      song: { ...preview, wikipedia_song: preview.wikipedia_song, wikipedia_artist: preview.wikipedia_artist, wikipedia_album: preview.wikipedia_album, ...(plan?.credits ? { ...plan.credits, title_raw: plan.credits.title } : {}) },
      source: () => preview?.source_url || null,
    });

    const cover = el('img', { class: 'cover xl', alt: '', src: preview.thumbnail });
    cover.addEventListener('error', () => cover.removeAttribute('src'));
    const title = el('div', { class: 't-headline' });
    const sub = el('div', { class: 't-subhead muted' });
    const albumLine = el('div', { class: 't-subhead muted' });
    const facts = el('div', { class: 't-time muted' });
    const paintMeta = () => {
      const v = sf.values({ commit: false });
      title.textContent = v.title || 'Untitled';
      sub.textContent = [artistString(v), v.releaseYear].filter(Boolean).join(' \u00b7 ');
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
      const badTrim = sf.trimProblem();
      if (badTrim) {
        err.replaceChildren(el('p', { class: 'msg error' }, badTrim));
        return;
      }
      save.disabled = true;
      try {
        const added = await api.addSong(preview.source_url, addBody(v), storedTags(v.tags), v.keep_title, preview.raw ?? null, sf.trimValue());
        if (added?.song && store.loaded) store.insert(added.song); else await store.refresh().catch(() => {});
        if (autoDownloadOn() && added?.id) autodl.request([added.id], { front: true });
        dlg.close();
        toast('Saved to library');
        if (draft) opts.onSaved?.(added);
      } catch (ex) {
        save.disabled = !!preview.in_library;
        err.replaceChildren(el('p', { class: 'msg error' }, sf.saveError(ex) || ex.message));
      }
    });
  }

  dlg.onclose = () => {
    gen += 1;
    for (const ctl of pending) ctl.abort();
    pending.clear();
    if (steps) steps.stop();
    steps = null;
    if (imp) imp.destroy();
    imp = null;
    dlg.classList.remove('import');
    preview = null;
    if (sf) sf.destroy();
    sf = null;
    dlg.replaceChildren();
    dlg.onclose = null;
    dlg.onclick = null;
  };
  dlg.replaceChildren(
    dialogHead('Add from YouTube or SoundCloud', 'Save the song\'s details; play it from the original link or on your iPhone.', () => dlg.close()),
    ...(note ? [el('p', { class: 'msg draft-note t-caption', role: 'note' }, note)] : []),
    form, known, message, body);
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  url.focus();
  if (plan?.url) {
    url.value = plan.url;
    checkKnown();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  } else if (query) {
    void runSearch(query);
  }
  if (!store.loaded) store.refresh().then(checkKnown).catch(() => {});
}
