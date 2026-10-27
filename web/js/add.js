import { api } from './api.js';
import { store } from './store.js';
import { el, toast } from './dom.js';
import { icon } from './icons.js';
import { cleanPasted } from './url-clean.js';
import { findInLibrary } from './library-match.js';
import { dialogHead } from './edit-dialog.js';
import { songForm } from './song-form.js';
import { ADD_ROW_OUTLINE_MS } from './constants.js';
import { hitRow, previewCard } from './add-preview.js';
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
  const urlPlan = opts?.url ? { url: opts.url, credits: null, note: opts.note || '' } : null;
  const plan = draft ? addPlan(draft) : urlPlan;
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

  async function runSearch(text) {
    const req = begin();
    body.replaceChildren(el('p', { class: 'add-hits-status t-caption muted', role: 'status' }, `Searching YouTube for "${text}"...`));
    try {
      const hits = await api.search(text, req.signal);
      if (!req.live()) return;
      body.replaceChildren(hits?.length
        ? el('ul', { class: 'add-hits', 'aria-label': `YouTube results for ${text}` }, ...hits.map((hit) => hitRow(hit, pickHit)))
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

    body.replaceChildren(previewCard({ preview, sf, dlg, onSaved: draft ? (added) => opts.onSaved?.(added) : null }));
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
