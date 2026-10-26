import { api } from './api.js';
import { tagEditor } from './tag-editor.js';
import { el, field } from './dom.js';
import { tokenGroup } from './token-field.js';
import { wikiFields } from './wiki-links.js';
import { chipField } from './chip-field.js';
import { linksPanel } from './links-panel.js';
import { storedLinkStates, wikipediaLink, linkError, linkErrors, ownSourceKind } from './song-links.js';
import { planMetadata, metaMessage, serviceState, suggestion, suggestionText } from './metadata-apply.js';
import { metadataBody, sourceList, artistString } from './song-payload.js';
import { creditsBlock, initialCredits } from './song-form-credits.js';
import { identifyBlock } from './identify-block.js';
import { hasAudio } from './playable.js';
import { cleanTitleEx } from './title-clean.js';
import { titleCleaner } from './song-form-title.js';
import { bpmRow } from './song-form-bpm.js';
import { unknownGenre } from './genre-vocab.js';
import { suggestedGenres, suggestedBox } from './suggested-genres.js';
import { trimBlock } from './trim-block.js';

const firstAlbum = (s) => (Array.isArray(s.albums) ? s.albums[0] : s.album) || '';

function applyPlan(plan, { f, editor, wiki }) {
  if (plan.album != null) f.album.value = plan.album;
  if (plan.released != null) {
    f.released.value = plan.released;
    f.released.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (plan.tags.length) editor.addTags(plan.tags);
  if (plan.wikipedia_song) wiki.set({ song: plan.wikipedia_song });
  if (plan.wikipedia_artist) wiki.set({ artist: plan.wikipedia_artist });
  if (plan.wikipedia_album) wiki.set({ album: plan.wikipedia_album });
}

const httpsOrNull = (u) => (/^https:\/\/\S+$/i.test(u || '') ? u : null);

function wikiEntry(wv) {
  return wikipediaLink(wv) || (httpsOrNull(wv.wikipedia_album) ? { url: wv.wikipedia_album, label: 'Wikipedia (album)' } : null);
}

function mergeLiveStates(out, base, lastStates) {
  for (const [k, v] of Object.entries(lastStates)) {
    if (v.on) out[k] = { ...base[k], ...v, url: v.url ?? base[k]?.url ?? null };
  }
}

function versionedStates(states, versioned) {
  if (!versioned) return states;
  return { ...states, musicbrainz: { on: false, url: null }, discogs: { on: false, url: null } };
}

function applyTitleAlbum(f, p) {
  if (p.title !== undefined) f.title.value = p.title ?? '';
  if (p.albums !== undefined) f.album.value = p.albums?.[0] ?? '';
  else if (p.album !== undefined) f.album.value = p.album ?? '';
}

function firstSource(initial) {
  const s = initial.sources?.[0];
  return s && typeof s === 'object' ? s : {};
}

const linkInput = (v) => el('input', { type: 'text', value: v || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });

const setUnlessFocused = (inp, value) => {
  if (globalThis.document?.activeElement !== inp) inp.value = value || '';
};

const whenLive = (req, fn) => { if (req.live()) fn(); };

const discogsOf = (s) => s.discogs_url ?? null;

const firstTitle = (isAdd, initial) => (isAdd ? cleanTitleEx(initial.title_raw ?? initial.title ?? '') : { title: initial.title || '', removed: [] });

const moreAlbumsOf = (initial) => (Array.isArray(initial.albums) ? initial.albums.slice(1) : []);

const storedLinkValues = (initial, storedLinks) => ({
  youtube: storedLinks.youtube?.url ?? null,
  soundcloud: storedLinks.soundcloud?.url ?? null,
  spotify: initial.spotify_url ?? null,
});

const storedStates = (initial, mbUrl, discogsUrl) => ({
  ...storedLinkStates(initial),
  ...(mbUrl ? { musicbrainz: { on: true, url: mbUrl } } : {}),
  ...(discogsUrl ? { discogs: { on: true, url: discogsUrl } } : {}),
});

const panelOptions = (isAdd) => ({
  readOnly: isAdd ? ['youtube', 'soundcloud'] : [],
  id: isAdd ? 'song-links-add' : 'song-links-edit',
});

function applyLinkVals(out, { linkVals, srcInp, isAdd }) {
  for (const k of Object.keys(linkVals)) {
    if (isAdd && k !== 'spotify') continue;
    if (linkVals[k] && !linkError(k, linkVals[k])) out[k] = { on: true, url: linkVals[k] };
    else delete out[k];
    setUnlessFocused(srcInp[k], linkVals[k]);
  }
}

function iconStates({ base, lastStates, wv, mbUrl, discogsUrl, linkVals, srcInp, isAdd }) {
  const out = { ...base };
  mergeLiveStates(out, base, lastStates);
  const wl = wikiEntry(wv);
  if (wl) out.wikipedia = { on: true, url: wl.url, label: wl.label };
  else if (!lastStates.wikipedia?.on) delete out.wikipedia;
  if (mbUrl) out.musicbrainz = { on: true, url: mbUrl };
  if (discogsUrl) out.discogs = { on: true, url: discogsUrl };
  applyLinkVals(out, { linkVals, srcInp, isAdd });
  return out;
}

function hintView(suggest, cur) {
  const sug = suggest ? suggestion(suggest, cur()) : null;
  return { hidden: !sug, text: sug ? `Wikipedia says: ${suggestionText(sug, cur())}` : '' };
}

function applySuggestion(f, sug) {
  if (sug.artist) f.artists.value = sug.artist;
  if (sug.title) f.title.value = sug.title;
}

function mergeMetadataUrls(states, mbUrl, discogsUrl) {
  return {
    mbUrl: states.musicbrainz.url || mbUrl,
    discogsUrl: states.discogs.url && !discogsUrl ? states.discogs.url : discogsUrl,
  };
}

function bindSrcInputs({ srcInp, linkVals, panel, own, paintIcons }) {
  for (const k of Object.keys(srcInp)) {
    srcInp[k].addEventListener('input', () => { linkVals[k] = srcInp[k].value.trim() || null; panel.setErrors(linkErrors(linkVals, { ownKind: own })); paintIcons(); });
  }
}

function wikiFromPlan(plan, cur) {
  return { song: plan.wikipedia_song ?? cur.wikipedia_song, artist: plan.wikipedia_artist ?? cur.wikipedia_artist, album: plan.wikipedia_album ?? cur.wikipedia_album };
}

function planLinkUrls(plan, versioned, mbUrl, discogsUrl) {
  return {
    mbUrl: plan.musicbrainz_url && !versioned ? plan.musicbrainz_url : mbUrl,
    discogsUrl: plan.discogs_url && !versioned ? plan.discogs_url : discogsUrl,
  };
}

function trimOptions(isAdd, initial) {
  const src0 = isAdd ? {} : firstSource(initial);
  return {
    start: isAdd ? null : src0.trim_start ?? null,
    end: isAdd ? null : src0.trim_end ?? null,
    hint: isAdd ? initial.trim_start_hint ?? null : null,
    duration: (isAdd ? initial.duration : src0.duration ?? initial.duration) || null,
    audio: !isAdd && hasAudio(initial),
    songId: initial.id,
    redownload: isAdd ? null : (id, cut) => api.redownload(id, cut),
  };
}

const identTarget = (isAdd, initial) => ({ id: isAdd ? null : initial.id, audio: !isAdd && hasAudio(initial) });

const ownLinkUrls = (isAdd, linkVals) => (isAdd ? {} : { youtube_url: linkVals.youtube, soundcloud_url: linkVals.soundcloud });

function withoutOwnLinks(errors, isAdd) {
  if (isAdd) {
    delete errors.youtube;
    delete errors.soundcloud;
  }
  return errors;
}

function commitChips(commit, ...chips) {
  if (commit) for (const c of chips) c.commit();
}

const initialValues = (initial, startTitle) => ({
  title: startTitle,
  ...initialCredits(initial),
  albums: [firstAlbum(initial)],
  wikipedia_song: initial.wikipedia_song || '',
  wikipedia_artist: initial.wikipedia_artist || '',
  wikipedia_album: initial.wikipedia_album || '',
});

export function songForm({ mode = 'add', song = {}, source = null, onChange = null } = {}) {
  const isAdd = mode === 'add';
  const initial = { ...song };
  const tg = tokenGroup();
  const first = firstTitle(isAdd, initial);
  const startTitle = first.title;
  const f = {
    title: tg.field('title', startTitle),
    album: el('input', { type: 'text', value: firstAlbum(initial) }),
  };
  const moreAlbums = moreAlbumsOf(initial);
  const credits = creditsBlock({
    tg,
    song: initial,
    getTitle: () => f.title.value,
    setTitle: (t) => { f.title.value = t; },
    emit: () => f.title.dispatchEvent(new Event('input', { bubbles: true })),
  });
  Object.assign(f, credits.f);
  const tags0 = initial.tags || [];
  const editor = tagEditor({ tags: tags0, suggested: isAdd ? tags0 : [], hideNs: true });
  const genres = chipField('genre', editor);
  const countries = chipField('country', editor);
  const wiki = wikiFields({ song: initial.wikipedia_song, artist: initial.wikipedia_artist, album: initial.wikipedia_album });

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
  let discogsUrl = discogsOf(initial);
  const own = isAdd ? null : ownSourceKind(initial);
  const storedLinks = storedLinkStates(initial);
  const linkVals = storedLinkValues(initial, storedLinks);
  let lastStates = {};
  const stored = () => storedStates(initial, mbUrl, discogsUrl);
  const mbInp = linkInput(mbUrl);
  const dcInp = linkInput(discogsUrl);
  const srcInp = { youtube: linkInput(linkVals.youtube), soundcloud: linkInput(linkVals.soundcloud), spotify: linkInput(linkVals.spotify) };
  const wf = wiki.fields;
  const panel = linksPanel({
    inputs: { wikipedia_song: wf.song.inp, wikipedia_artist: wf.artist.inp, wikipedia_album: wf.album.inp, musicbrainz: mbInp, discogs: dcInp, ...srcInp },
    ...panelOptions(isAdd),
  });
  const icons = panel.summary;
  const paintIcons = () => {
    const wv = wiki.values();
    const out = iconStates({ base: stored(), lastStates, wv, mbUrl, discogsUrl, linkVals, srcInp, isAdd });
    setUnlessFocused(mbInp, mbUrl);
    setUnlessFocused(dcInp, discogsUrl);
    panel.paint({
      youtube: out.youtube?.url ?? '', soundcloud: out.soundcloud?.url ?? '', spotify: out.spotify?.url ?? '',
      wikipedia_song: wv.wikipedia_song, wikipedia_artist: wv.wikipedia_artist, wikipedia_album: wv.wikipedia_album,
      musicbrainz: mbUrl, discogs: discogsUrl,
    }, out);
  };
  const fromInput = (inp) => (inp.value.trim() || null);
  mbInp.addEventListener('input', () => { mbUrl = fromInput(mbInp); paintIcons(); });
  dcInp.addEventListener('input', () => { discogsUrl = fromInput(dcInp); paintIcons(); });
  bindSrcInputs({ srcInp, linkVals, panel, own, paintIcons });
  for (const r of Object.values(wf)) r.inp.addEventListener('input', paintIcons);
  const resetIcons = () => {
    lastStates = {};
    icons.reset();
    paintIcons();
  };
  resetIcons();
  const metaBtn = el('button', { class: 'btn outline small', type: 'button' }, 'Get metadata');
  const metaMsg = el('p', { class: 't-caption muted', role: 'status' });
  const orig = suggestedBox({ have: () => editor.peek(), onPick: (tag) => editor.addTags([tag]) });
  if (isAdd) orig.set(suggestedGenres(initial, tags0));
  editor.subscribe(() => orig.refresh());
  const hint = el('button', { class: 'link-btn t-caption wiki-hint', type: 'button', hidden: true });
  let suggest = null;
  let discogsState = null;
  const emit = () => f.title.dispatchEvent(new Event('input', { bubbles: true }));
  const tc = titleCleaner({ f, isAdd, initial, first, emit });
  const cur = () => ({ title: f.title.value, artist: artistString({ mainArtists: credits.values().mainArtists }) });
  const paintHint = () => {
    const view = hintView(suggest, cur);
    hint.hidden = view.hidden;
    hint.textContent = view.text;
  };
  hint.addEventListener('click', () => {
    const sug = suggestion(suggest, cur());
    if (!sug) return;
    applySuggestion(f, sug);
    paintHint();
    emit();
  });
  f.title.addEventListener('input', paintHint);
  f.artists.addEventListener('input', paintHint);

  const resetMeta = () => {
    suggest = null;
    discogsState = null;
    resetIcons();
    metaMsg.textContent = '';
    orig.clear();
    paintHint();
  };
  const applyMeta = (resp) => {
    const plan = planMetadata(resp, { album: f.album.value, released: f.released.value, versioned: credits.hasVersion(), tags: editor.peek(), ...wiki.values() });
    applyPlan(plan, { f, editor, wiki });
    credits.setPublished(resp?.published_year);
    credits.setSpecific(resp?.version_year ?? resp?.remix_year);
    credits.setOriginal(resp?.suggest?.artist);
    f.album.dispatchEvent(new Event('input', { bubbles: true }));
    orig.set(suggestedGenres(resp, editor.peek()));
    metaMsg.textContent = metaMessage(plan, discogsState, orig.count());
  };
  const finishMetadata = (resp) => {
    icons.setBusy(false);
    const states = versionedStates(serviceState(resp?.services), credits.hasVersion());
    ({ mbUrl, discogsUrl } = mergeMetadataUrls(states, mbUrl, discogsUrl));
    discogsState = states.discogs;
    lastStates = states;
    paintIcons();
    suggest = resp?.suggest || null;
    applyMeta(resp);
    paintHint();
  };
  const failMetadata = () => {
    resetIcons();
    metaMsg.textContent = 'Couldn\'t load metadata';
  };
  const restoreMetaBtn = () => {
    metaBtn.disabled = false;
    metaBtn.textContent = 'Get metadata';
  };
  metaBtn.addEventListener('click', async () => {
    const wv = wiki.values();
    const body = metadataBody({ title: f.title.value, ...credits.values(), ...wv, discogs_url: discogsUrl }, sourceList(typeof source === 'function' ? source() : source));
    const req = begin();
    resetMeta();
    metaBtn.disabled = true;
    metaBtn.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Getting metadata...');
    icons.setBusy(true);
    try {
      const resp = await api.metadata(body, req.signal);
      whenLive(req, () => finishMetadata(resp));
    } catch {
      whenLive(req, failMetadata);
    } finally {
      req.done();
      whenLive(req, restoreMetaBtn);
    }
  });

  const setReleased = (y) => {
    f.released.value = y;
    f.released.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const applyLinks = (plan) => {
    wiki.set(wikiFromPlan(plan, wiki.values()));
    ({ mbUrl, discogsUrl } = planLinkUrls(plan, credits.hasVersion(), mbUrl, discogsUrl));
    paintIcons();
    emit();
  };
  const ident = identifyBlock({ ...identTarget(isAdd, initial), editor, getReleased: () => f.released.value, setReleased, applyLinks });

  const bpmEl = bpmRow({ isAdd, initial });
  const trim = trimBlock(trimOptions(isAdd, initial));

  const node = el('div', { class: 'add-fields' },
    tc.node, credits.node,
    hint,
    el('div', { class: 'meta-row' }, el('div', { class: 'lk-slot' }, panel.bar), el('div', { class: 'meta-btns' }, metaBtn, ident.button)),
    panel.clip,
    metaMsg,
    ident.node,
    el('div', { class: 'grid2' }, field('Album', f.album), field('First released', f.released)),
    bpmEl,
    genres.node, orig.node, countries.node,
    el('div', { class: 'field' }, el('label', {}, 'Tags'), editor.node));
  node.append(trim.node);
  node.addEventListener('input', credits.paint);
  if (onChange) node.addEventListener('input', onChange);

  const values = ({ commit = true } = {}) => {
    commitChips(commit, genres, countries);
    return {
      title: f.title.value,
      keep_title: tc.restoredRaw !== null && f.title.value === tc.restoredRaw,
      ...credits.values(),
      albums: [f.album.value.trim(), ...moreAlbums].filter(Boolean),
      tags: editor.getTags({ commit }),
      ...wiki.values(),
      musicbrainz_url: mbUrl,
      discogs_url: discogsUrl,
      spotify_url: linkVals.spotify,
      ...ownLinkUrls(isAdd, linkVals),
    };
  };
  const linkProblems = () => {
    const errors = withoutOwnLinks(linkErrors(linkVals, { ownKind: own }), isAdd);
    panel.setErrors(errors);
    return Object.values(errors)[0] || null;
  };
  const setValues = (p = {}) => {
    applyTitleAlbum(f, p);
    credits.set(p);
    wiki.set({ song: p.wikipedia_song, artist: p.wikipedia_artist, album: p.wikipedia_album });
    paintIcons();
    emit();
  };

  return {
    node,
    values,
    linkProblems,
    trimProblem: () => trim.check(),
    trimValue: () => trim.value(),
    trimChanged: () => trim.changed(),
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
      discogsUrl = discogsOf(initial);
      Object.assign(linkVals, storedLinkValues(initial, storedLinks));
      panel.setErrors({});
      ident.reset();
      resetMeta();
      orig.forget();
      metaBtn.disabled = false;
      metaBtn.textContent = 'Get metadata';
      trim.reset();
      tc.clearRestored();
      tc.paintCleaned(first.removed);
      setValues(initialValues(initial, startTitle));
      credits.resetYear(initial.published_year);
    },
    destroy() {
      abortAll();
      ident.destroy();
    },
  };
}
