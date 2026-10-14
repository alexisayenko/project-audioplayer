import { api } from './api.js';
import { MIN_YEAR, maxYear } from './constants.js';
import { tagEditor } from './tag-editor.js';
import { el, field } from './dom.js';
import { tokenGroup } from './token-field.js';
import { wikiFields } from './wiki-links.js';
import { chipField } from './chip-field.js';
import { serviceIcons } from './service-icons.js';
import { storedLinkStates } from './song-links.js';
import { planMetadata, statusText, serviceState, suggestion, suggestionText } from './metadata-apply.js';
import { metadataBody, sourceList } from './song-payload.js';
import { identifyBlock } from './identify-block.js';
import { hasAudio } from './playable.js';
import { cleanTitleEx } from './title-clean.js';
import { titleCleaner } from './song-form-title.js';
import { bpmRow } from './song-form-bpm.js';

export function songForm({ mode = 'add', song = {}, source = null, onChange = null } = {}) {
  const isAdd = mode === 'add';
  const initial = { ...song };
  const tg = tokenGroup();
  const first = isAdd ? cleanTitleEx(initial.title_raw ?? initial.title ?? '') : { title: initial.title || '', removed: [] };
  const startTitle = first.title;
  const f = {
    title: tg.field('title', startTitle),
    artist: tg.field('artist', initial.artist || ''),
    remixer: tg.field('remixer', initial.remixer || ''),
    album: el('input', { type: 'text', value: initial.album || '' }),
    year: el('input', { type: 'number', value: initial.year ?? '', min: MIN_YEAR, max: maxYear() }),
    remixYear: el('input', { type: 'number', value: initial.remix_year ?? '', min: MIN_YEAR, max: maxYear() }),
  };
  const editor = tagEditor({ tags: initial.tags || [], suggested: isAdd ? initial.tags || [] : [], year: f.year, hideNs: true });
  const genres = chipField('genre', editor);
  const countries = chipField('country', editor);
  const wiki = wikiFields({ song: initial.wikipedia_song, artist: initial.wikipedia_artist });

  let gen = 0;
  const pending = new Set();
  const begin = () => {
    const ctl = new AbortController();
    pending.add(ctl);
    const mine = gen;
    return { signal: ctl.signal, live: () => mine === gen, done: () => pending.delete(ctl) };
  };
  const abortAll = () => {
    gen += 1;
    for (const ctl of pending) ctl.abort();
    pending.clear();
  };

  const icons = serviceIcons();
  const initialMb = () => serviceState({ musicbrainz: { found: true, url: initial.musicbrainz_url } }).musicbrainz.url;
  let mbUrl = initialMb();
  let discogsUrl = initial.discogs_url ?? null;
  let lastStates = {};
  const stored = () => ({
    ...storedLinkStates(initial),
    ...(mbUrl ? { musicbrainz: { on: true, url: mbUrl } } : {}),
    ...(discogsUrl ? { discogs: { on: true, url: discogsUrl } } : {}),
  });
  const paintIcons = () => {
    const base = stored();
    const out = { ...base };
    for (const [k, v] of Object.entries(lastStates)) if (v.on) out[k] = { ...base[k], ...v, url: v.url ?? base[k]?.url ?? null };
    icons.setState(out);
  };
  const resetIcons = () => {
    lastStates = {};
    icons.reset();
    paintIcons();
  };
  resetIcons();
  const metaBtn = el('button', { class: 'btn outline small', type: 'button' }, 'Get metadata');
  const metaMsg = el('p', { class: 't-caption muted', role: 'status' });
  const hint = el('button', { class: 'link-btn t-caption wiki-hint', type: 'button', hidden: true });
  let suggest = null;
  const emit = () => f.title.dispatchEvent(new Event('input', { bubbles: true }));
  const tc = titleCleaner({ f, isAdd, initial, first, emit });
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
    paintHint();
    emit();
  });
  f.title.addEventListener('input', paintHint);
  f.artist.addEventListener('input', paintHint);

  const resetMeta = () => {
    suggest = null;
    resetIcons();
    metaMsg.textContent = '';
    paintHint();
  };
  const applyMeta = (resp) => {
    const plan = planMetadata(resp, { album: f.album.value, year: f.year.value, tags: editor.peek() });
    if (plan.album != null) f.album.value = plan.album;
    if (plan.year != null) {
      f.year.value = plan.year;
      f.year.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (plan.tags.length) editor.addTags(plan.tags);
    f.album.dispatchEvent(new Event('input', { bubbles: true }));
    metaMsg.textContent = statusText(plan);
  };
  metaBtn.addEventListener('click', async () => {
    const wv = wiki.values();
    const src = typeof source === 'function' ? source() : source;
    const body = metadataBody({ title: f.title.value, artist: f.artist.value, ...wv }, sourceList(src));
    const req = begin();
    resetMeta();
    metaBtn.disabled = true;
    metaBtn.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Getting metadata...');
    icons.setBusy(true);
    try {
      const resp = await api.metadata(body, req.signal);
      if (!req.live()) return;
      icons.setBusy(false);
      const states = serviceState(resp?.services);
      if (states.musicbrainz.url) mbUrl = states.musicbrainz.url;
      lastStates = states;
      paintIcons();
      suggest = resp?.suggest || null;
      applyMeta(resp);
      paintHint();
    } catch {
      if (!req.live()) return;
      resetIcons();
      metaMsg.textContent = 'Couldn\'t load metadata';
    } finally {
      req.done();
      if (req.live()) {
        metaBtn.disabled = false;
        metaBtn.textContent = 'Get metadata';
      }
    }
  });

  const setYear = (y) => {
    f.year.value = y;
    f.year.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const applyLinks = (plan) => {
    const cur = wiki.values();
    wiki.set({ song: plan.wikipedia_song ?? cur.wikipedia_song, artist: plan.wikipedia_artist ?? cur.wikipedia_artist });
    if (plan.musicbrainz_url) mbUrl = plan.musicbrainz_url;
    if (plan.discogs_url) discogsUrl = plan.discogs_url;
    paintIcons();
    emit();
  };
  const ident = identifyBlock({ id: isAdd ? null : initial.id, audio: !isAdd && hasAudio(initial), editor, getYear: () => f.year.value, setYear, applyLinks });

  const bpmEl = bpmRow({ isAdd, initial });

  const node = el('div', { class: 'add-fields' },
    tc.node, field('Artist', f.artist),
    el('div', { class: 'remix-row' }, field('Remix & additional production', f.remixer), field('Remix year', f.remixYear)),
    hint,
    el('div', { class: 'meta-row' }, metaBtn, icons.node),
    metaMsg,
    ident.node,
    el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
    bpmEl,
    genres.node, countries.node,
    el('div', { class: 'field' }, el('label', {}, 'Tags'), editor.node),
    wiki.node);
  if (onChange) node.addEventListener('input', onChange);

  const values = ({ commit = true } = {}) => {
    if (commit) {
      genres.commit();
      countries.commit();
    }
    return {
      title: f.title.value,
      keep_title: tc.restoredRaw !== null && f.title.value === tc.restoredRaw,
      artist: f.artist.value,
      remixer: f.remixer.value,
      album: f.album.value,
      year: f.year.value,
      remix_year: f.remixYear.value,
      tags: editor.getTags(),
      ...wiki.values(),
      musicbrainz_url: mbUrl,
      discogs_url: discogsUrl,
    };
  };
  const setValues = (p = {}) => {
    for (const k of ['title', 'artist', 'remixer', 'album']) if (p[k] !== undefined) f[k].value = p[k] ?? '';
    if (p.year !== undefined) f.year.value = p.year ?? '';
    if (p.remix_year !== undefined) f.remixYear.value = p.remix_year ?? '';
    wiki.set({ song: p.wikipedia_song, artist: p.wikipedia_artist });
    emit();
  };

  return {
    node,
    values,
    setValues,
    focus: () => f.title.focus(),
    reset() {
      abortAll();
      mbUrl = initialMb();
      discogsUrl = initial.discogs_url ?? null;
      ident.reset();
      resetMeta();
      metaBtn.disabled = false;
      metaBtn.textContent = 'Get metadata';
      tc.clearRestored();
      tc.paintCleaned(first.removed);
      setValues({ title: startTitle, artist: initial.artist || '', remixer: initial.remixer || '', album: initial.album || '', year: initial.year ?? '', remix_year: initial.remix_year ?? '', wikipedia_song: initial.wikipedia_song || '', wikipedia_artist: initial.wikipedia_artist || '' });
    },
    destroy() {
      abortAll();
      ident.destroy();
    },
  };
}
