import { api } from './api.js';
import { MIN_YEAR, maxYear } from './constants.js';
import { tagEditor } from './tag-editor.js';
import { el, field } from './dom.js';
import { tokenGroup } from './token-field.js';
import { wikiFields } from './wiki-links.js';
import { chipField } from './chip-field.js';
import { linksPanel } from './links-panel.js';
import { storedLinkStates, wikipediaLink, linkError, linkErrors, ownSourceKind } from './song-links.js';
import { planMetadata, statusText, serviceState, suggestion, suggestionText } from './metadata-apply.js';
import { metadataBody, sourceList } from './song-payload.js';
import { identifyBlock } from './identify-block.js';
import { hasAudio } from './playable.js';
import { cleanTitleEx } from './title-clean.js';
import { titleCleaner } from './song-form-title.js';
import { bpmRow } from './song-form-bpm.js';
import { unknownGenre } from './genre-vocab.js';
import { planRemixYear, validYear } from './remix-year.js';

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
  const wiki = wikiFields({ song: initial.wikipedia_song, artist: initial.wikipedia_artist, album: initial.wikipedia_album });

  let pubYear = validYear(initial.published_year);
  let specYear = null;
  let remixAuto = false;
  let remixTouched = false;
  const syncRemixYear = () => {
    if (remixTouched) return;
    const plan = planRemixYear({ remixer: f.remixer.value, current: f.remixYear.value, auto: remixAuto, published: pubYear, specific: specYear });
    remixAuto = plan.auto;
    f.remixYear.classList.toggle('suggested', remixAuto);
    f.remixYear.title = remixAuto ? 'Suggested from the YouTube or SoundCloud publish date; type a year to replace it' : '';
    if (plan.value !== f.remixYear.value) f.remixYear.value = plan.value;
  };
  f.remixYear.addEventListener('input', () => {
    remixTouched = true;
    remixAuto = false;
    f.remixYear.classList.remove('suggested');
    f.remixYear.title = '';
  });
  f.remixer.addEventListener('input', syncRemixYear);
  syncRemixYear();

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

  const initialMb = () => serviceState({ musicbrainz: { found: true, url: initial.musicbrainz_url } }).musicbrainz.url;
  let mbUrl = initialMb();
  let discogsUrl = initial.discogs_url ?? null;
  const own = isAdd ? null : ownSourceKind(initial);
  const storedLinks = storedLinkStates(initial);
  const linkVals = { youtube: storedLinks.youtube?.url ?? null, soundcloud: storedLinks.soundcloud?.url ?? null, spotify: initial.spotify_url ?? null };
  let lastStates = {};
  const stored = () => ({
    ...storedLinkStates(initial),
    ...(mbUrl ? { musicbrainz: { on: true, url: mbUrl } } : {}),
    ...(discogsUrl ? { discogs: { on: true, url: discogsUrl } } : {}),
  });
  const linkInp = (v) => el('input', { type: 'text', value: v || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const mbInp = linkInp(mbUrl);
  const dcInp = linkInp(discogsUrl);
  const srcInp = { youtube: linkInp(linkVals.youtube), soundcloud: linkInp(linkVals.soundcloud), spotify: linkInp(linkVals.spotify) };
  const wf = wiki.fields;
  const panel = linksPanel({
    inputs: { wikipedia_song: wf.song.inp, wikipedia_artist: wf.artist.inp, wikipedia_album: wf.album.inp, musicbrainz: mbInp, discogs: dcInp, ...srcInp },
    readOnly: isAdd ? ['youtube', 'soundcloud'] : [],
    id: isAdd ? 'song-links-add' : 'song-links-edit',
  });
  const icons = panel.summary;
  const paintIcons = () => {
    const base = stored();
    const out = { ...base };
    for (const [k, v] of Object.entries(lastStates)) if (v.on) out[k] = { ...base[k], ...v, url: v.url ?? base[k]?.url ?? null };
    const wv = wiki.values();
    const https = (u) => (/^https:\/\/\S+$/i.test(u || '') ? u : null);
    const wl = wikipediaLink(wv) || (https(wv.wikipedia_album) ? { url: wv.wikipedia_album, label: 'Wikipedia (album)' } : null);
    if (wl) out.wikipedia = { on: true, url: wl.url, label: wl.label };
    else if (!lastStates.wikipedia?.on) delete out.wikipedia;
    if (mbUrl) out.musicbrainz = { on: true, url: mbUrl };
    if (discogsUrl) out.discogs = { on: true, url: discogsUrl };
    for (const k of Object.keys(linkVals)) {
      if (isAdd && k !== 'spotify') continue;
      if (linkVals[k] && !linkError(k, linkVals[k])) out[k] = { on: true, url: linkVals[k] };
      else delete out[k];
      if (globalThis.document?.activeElement !== srcInp[k]) srcInp[k].value = linkVals[k] || '';
    }
    if (globalThis.document?.activeElement !== mbInp) mbInp.value = mbUrl || '';
    if (globalThis.document?.activeElement !== dcInp) dcInp.value = discogsUrl || '';
    panel.paint({
      youtube: out.youtube?.url ?? '', soundcloud: out.soundcloud?.url ?? '', spotify: out.spotify?.url ?? '',
      wikipedia_song: wv.wikipedia_song, wikipedia_artist: wv.wikipedia_artist, wikipedia_album: wv.wikipedia_album,
      musicbrainz: mbUrl, discogs: discogsUrl,
    }, out);
  };
  const fromInput = (inp) => (inp.value.trim() || null);
  mbInp.addEventListener('input', () => { mbUrl = fromInput(mbInp); paintIcons(); });
  dcInp.addEventListener('input', () => { discogsUrl = fromInput(dcInp); paintIcons(); });
  for (const k of Object.keys(srcInp)) {
    srcInp[k].addEventListener('input', () => { linkVals[k] = fromInput(srcInp[k]); panel.setErrors(linkErrors(linkVals, { ownKind: own })); paintIcons(); });
  }
  for (const r of Object.values(wf)) r.inp.addEventListener('input', paintIcons);
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
    const plan = planMetadata(resp, { album: f.album.value, year: f.year.value, tags: editor.peek(), ...wiki.values() });
    if (plan.album != null) f.album.value = plan.album;
    if (plan.year != null) {
      f.year.value = plan.year;
      f.year.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (plan.tags.length) editor.addTags(plan.tags);
    if (plan.wikipedia_song) wiki.set({ song: plan.wikipedia_song });
    if (plan.wikipedia_artist) wiki.set({ artist: plan.wikipedia_artist });
    if (plan.wikipedia_album) wiki.set({ album: plan.wikipedia_album });
    if (validYear(resp?.published_year)) pubYear = resp.published_year;
    specYear = validYear(resp?.remix_year);
    syncRemixYear();
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
    wiki.set({ song: plan.wikipedia_song ?? cur.wikipedia_song, artist: plan.wikipedia_artist ?? cur.wikipedia_artist, album: plan.wikipedia_album ?? cur.wikipedia_album });
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
    el('div', { class: 'meta-row' }, el('div', { class: 'lk-slot' }, panel.bar), el('div', { class: 'meta-btns' }, metaBtn, ident.button)),
    panel.clip,
    metaMsg,
    ident.node,
    el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
    bpmEl,
    genres.node, countries.node,
    el('div', { class: 'field' }, el('label', {}, 'Tags'), editor.node));
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
      spotify_url: linkVals.spotify,
      ...(isAdd ? {} : { youtube_url: linkVals.youtube, soundcloud_url: linkVals.soundcloud }),
    };
  };
  const linkProblems = () => {
    const errors = linkErrors(linkVals, { ownKind: own });
    if (isAdd) {
      delete errors.youtube;
      delete errors.soundcloud;
    }
    panel.setErrors(errors);
    return Object.values(errors)[0] || null;
  };
  const setValues = (p = {}) => {
    for (const k of ['title', 'artist', 'remixer', 'album']) if (p[k] !== undefined) f[k].value = p[k] ?? '';
    if (p.year !== undefined) f.year.value = p.year ?? '';
    if (p.remix_year !== undefined) {
      f.remixYear.value = p.remix_year ?? '';
      remixAuto = false;
      f.remixYear.classList.remove('suggested');
      f.remixYear.title = '';
    }
    wiki.set({ song: p.wikipedia_song, artist: p.wikipedia_artist, album: p.wikipedia_album });
    paintIcons();
    emit();
  };

  return {
    node,
    values,
    linkProblems,
    setValues,
    focus: () => f.title.focus(),
    saveError(ex) {
      const u = unknownGenre(ex);
      if (!u) return null;
      genres.reject(u);
      return `"${u.value}" is not in the genre list. Pick a genre under Genres.`;
    },
    reset() {
      abortAll();
      mbUrl = initialMb();
      discogsUrl = initial.discogs_url ?? null;
      Object.assign(linkVals, { youtube: storedLinks.youtube?.url ?? null, soundcloud: storedLinks.soundcloud?.url ?? null, spotify: initial.spotify_url ?? null });
      panel.setErrors({});
      ident.reset();
      resetMeta();
      metaBtn.disabled = false;
      metaBtn.textContent = 'Get metadata';
      tc.clearRestored();
      tc.paintCleaned(first.removed);
      setValues({ title: startTitle, artist: initial.artist || '', remixer: initial.remixer || '', album: initial.album || '', year: initial.year ?? '', remix_year: initial.remix_year ?? '', wikipedia_song: initial.wikipedia_song || '', wikipedia_artist: initial.wikipedia_artist || '', wikipedia_album: initial.wikipedia_album || '' });
      pubYear = validYear(initial.published_year);
      specYear = null;
      remixTouched = false;
      syncRemixYear();
    },
    destroy() {
      abortAll();
      ident.destroy();
    },
  };
}
