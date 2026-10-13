import { api } from './api.js';
import { store } from './store.js';
import { tagEditor } from './tag-editor.js';
import { el, fmtTime, toast } from './dom.js';
import { icon } from './icons.js';
import { cleanPasted, sourceOf, sourceLabel } from './url-clean.js';
import { findInLibrary } from './library-match.js';
import { wikiFields } from './wiki-links.js';
import { dialogHead } from './edit-dialog.js';
import { chipField } from './chip-field.js';
import { serviceIcons } from './service-icons.js';
import { planMetadata, statusText, serviceState, suggestion, suggestionText } from './metadata-apply.js';

const BULK = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertReplacementText']);
const PREVIEW_ONLY = 'Preview only \u2014 SoundCloud Go+ track, can\'t be downloaded in full.';
const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);

export function openAdd() {
  const dlg = document.getElementById('add-dialog');
  let preview = null;
  let gen = 0;
  const pending = new Set();
  const begin = () => {
    const ctl = new AbortController();
    pending.add(ctl);
    const mine = gen;
    return { signal: ctl.signal, live: () => mine === gen && dlg.open, done: () => pending.delete(ctl) };
  };

  const url = el('input', { type: 'url', placeholder: 'Paste a YouTube or SoundCloud link', 'aria-label': 'YouTube or SoundCloud link', autocomplete: 'off', inputMode: 'url' });
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
    setTimeout(() => { row.style.outline = ''; }, 2500);
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
    const f = {
      title: el('input', { type: 'text', value: preview.title || '' }),
      artist: el('input', { type: 'text', value: preview.artist || '' }),
      album: el('input', { type: 'text', value: preview.album || '' }),
      year: el('input', { type: 'number', value: preview.year ?? '', min: 0, max: 3000 }),
      bpm: el('input', { type: 'number', min: 20, max: 300, step: 1, placeholder: 'Detected after saving' }),
    };
    const editor = tagEditor({ tags: preview.tags || [], suggested: preview.tags || [], year: f.year, hideNs: true });
    const genres = chipField('genre', editor);
    const countries = chipField('country', editor);
    const wiki = wikiFields({ song: preview.wikipedia_song, artist: preview.wikipedia_artist });

    const cover = el('img', { class: 'cover xl', alt: '', src: preview.thumbnail });
    cover.addEventListener('error', () => cover.removeAttribute('src'));
    const title = el('div', { class: 't-headline' });
    const sub = el('div', { class: 't-subhead muted' });
    const facts = el('div', { class: 't-time muted' });
    const paintMeta = () => {
      title.textContent = f.title.value || 'Untitled';
      sub.textContent = [f.artist.value, f.album.value, f.year.value].filter(Boolean).join(' · ');
      facts.textContent = [preview.duration ? fmtTime(preview.duration) : '', f.bpm.value ? `${f.bpm.value} BPM` : ''].filter(Boolean).join(' · ');
    };
    for (const i of Object.values(f)) i.addEventListener('input', paintMeta);
    paintMeta();

    const icons = serviceIcons();
    const metaBtn = el('button', { class: 'btn outline small', type: 'button' }, 'Get metadata');
    const metaMsg = el('p', { class: 't-caption muted', role: 'status' });
    const hint = el('button', { class: 'link-btn t-caption wiki-hint', type: 'button', hidden: true });
    let suggest = null;
    const cur = () => ({ title: f.title.value, artist: f.artist.value });
    const paintHint = () => {
      const sug = suggest ? suggestion(suggest, cur()) : null;
      hint.hidden = !sug;
      hint.textContent = sug ? `Wikipedia says: ${suggestionText(sug, cur())}` : '';
    };
    hint.addEventListener('click', () => {
      const sug = suggestion(suggest, cur());
      if (!sug) return;
      if (sug.artist) f.artist.value = sug.artist;
      if (sug.title) f.title.value = sug.title;
      paintMeta();
      paintHint();
    });
    f.title.addEventListener('input', paintHint);
    f.artist.addEventListener('input', paintHint);

    const applyMeta = (resp) => {
      const plan = planMetadata(resp, { album: f.album.value, year: f.year.value, tags: editor.peek() });
      if (plan.album != null) f.album.value = plan.album;
      if (plan.year != null) {
        f.year.value = plan.year;
        f.year.dispatchEvent(new Event('input'));
      }
      if (plan.tags.length) editor.addTags(plan.tags);
      paintMeta();
      metaMsg.textContent = statusText(plan);
    };
    const resetMeta = () => {
      suggest = null;
      icons.reset();
      metaMsg.textContent = '';
      paintHint();
    };
    metaBtn.addEventListener('click', async () => {
      const wv = wiki.values();
      const req = begin();
      resetMeta();
      metaBtn.disabled = true;
      metaBtn.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Getting metadata...');
      icons.setBusy(true);
      try {
        const resp = await api.metadata({
          title: f.title.value.trim(),
          artist: f.artist.value.trim(),
          sources: preview.source_url ? [{ url: preview.source_url }] : [],
          ...(wv.wikipedia_song ? { wiki_song: wv.wikipedia_song } : {}),
          ...(wv.wikipedia_artist ? { wiki_artist: wv.wikipedia_artist } : {}),
        }, req.signal);
        if (!req.live()) return;
        icons.setBusy(false);
        icons.setState(serviceState(resp?.services));
        suggest = resp?.suggest || null;
        applyMeta(resp);
        paintHint();
      } catch {
        if (!req.live()) return;
        icons.reset();
        metaMsg.textContent = 'Couldn\'t load metadata';
      } finally {
        req.done();
        if (req.live()) {
          metaBtn.disabled = false;
          metaBtn.textContent = 'Get metadata';
        }
      }
    });

    const save = el('button', { class: 'btn primary glow big', type: 'submit', disabled: !!preview.in_library }, icon('plus', 20), 'Save to library');
    const err = el('div');

    const card = el('form', { class: 'add-card' },
      el('div', { class: 'preview-row' }, cover, el('div', { class: 'preview-meta' }, title, sub, facts,
        el('span', { class: 'chip tint', title: 'Source' }, sourceLabel(preview.source || sourceOf(preview.id))))),
      el('div', { class: 'add-fields' },
        field('Title', f.title), field('Artist', f.artist),
        el('div', { class: 'meta-row' }, metaBtn, icons.node),
        metaMsg, hint,
        el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
        field('BPM (optional)', f.bpm),
        genres.node, countries.node,
        el('div', { class: 'field' }, el('label', {}, 'Tags'), editor.node),
        wiki.node),
      err,
      el('div', { class: 'add-foot' }, save));
    body.replaceChildren(card);

    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      genres.commit();
      countries.commit();
      const tags = editor.getTags();
      try {
        await api.addSong(preview.source_url, {
          title: f.title.value,
          artist: f.artist.value,
          album: f.album.value,
          year: f.year.value === '' ? null : Number(f.year.value),
          bpm: f.bpm.value === '' ? null : Math.round(Number(f.bpm.value)),
          ...wiki.values(),
        }, tags);
        await store.refresh().catch(() => {});
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
