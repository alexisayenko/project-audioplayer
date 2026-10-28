import { api } from './api.js';
import { tagEditor } from './tag-editor.js';
import { el, field } from './dom.js';
import { tokenGroup } from './token-field.js';
import { wikiFields } from './wiki-links.js';
import { chipField } from './chip-field.js';
import { labelField } from './label-field.js';
import { labelsOf } from './label-names.js';
import { linkSection, ownLinkUrls } from './song-form-links.js';
import { metadataSection } from './song-form-meta.js';
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

function applyTitleAlbum(f, p) {
  if (p.title !== undefined) f.title.value = p.title ?? '';
  if (p.albums !== undefined) f.album.value = p.albums?.[0] ?? '';
  else if (p.album !== undefined) f.album.value = p.album ?? '';
}

function firstSource(initial) {
  const s = initial.sources?.[0];
  return s && typeof s === 'object' ? s : {};
}

const firstTitle = (isAdd, initial) => (isAdd ? cleanTitleEx(initial.title_raw ?? initial.title ?? '') : { title: initial.title || '', removed: [] });

const moreAlbumsOf = (initial) => (Array.isArray(initial.albums) ? initial.albums.slice(1) : []);

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
  const labels = labelField({ initial: labelsOf(initial) });
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

  const links = linkSection({ isAdd, initial, wiki });
  const orig = suggestedBox({ have: () => editor.peek(), onPick: (tag) => editor.addTags([tag]) });
  if (isAdd) orig.set(suggestedGenres(initial, tags0));
  editor.subscribe(() => orig.refresh());
  const emit = () => f.title.dispatchEvent(new Event('input', { bubbles: true }));
  const tc = titleCleaner({ f, isAdd, initial, first, emit });
  const meta = metadataSection({ f, credits, editor, wiki, links, orig, source, begin, emit });

  const setReleased = (y) => {
    f.released.value = y;
    f.released.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const applyLinks = (plan) => {
    wiki.set(wikiFromPlan(plan, wiki.values()));
    Object.assign(links.state, planLinkUrls(plan, credits.hasVersion(), links.state.mbUrl, links.state.discogsUrl));
    links.paintIcons();
    emit();
  };
  const ident = identifyBlock({ ...identTarget(isAdd, initial), editor, getReleased: () => f.released.value, setReleased, applyLinks });

  const bpmEl = bpmRow({ isAdd, initial });
  const trim = trimBlock(trimOptions(isAdd, initial));

  const node = el('div', { class: 'add-fields' },
    tc.node, credits.node,
    meta.hint,
    el('div', { class: 'meta-row' }, el('div', { class: 'lk-slot' }, links.panel.bar), el('div', { class: 'meta-btns' }, meta.metaBtn, ident.button)),
    links.panel.clip,
    meta.metaMsg,
    ident.node,
    el('div', { class: 'grid2' }, field('Album', f.album), field('First released', f.released)),
    labels.node,
    bpmEl,
    genres.node, orig.node, countries.node,
    el('div', { class: 'field' }, el('label', {}, 'Tags'), editor.node));
  node.append(trim.node);
  node.addEventListener('input', credits.paint);
  if (onChange) node.addEventListener('input', onChange);
  labels.subscribe(emit);

  const values = ({ commit = true } = {}) => {
    commitChips(commit, genres, countries, labels);
    return {
      title: f.title.value,
      keep_title: tc.restoredRaw !== null && f.title.value === tc.restoredRaw,
      ...credits.values(),
      albums: [f.album.value.trim(), ...moreAlbums].filter(Boolean),
      labels: labels.get(),
      tags: editor.getTags({ commit }),
      ...wiki.values(),
      musicbrainz_url: links.state.mbUrl,
      discogs_url: links.state.discogsUrl,
      spotify_url: links.linkVals.spotify,
      ...ownLinkUrls(isAdd, links.linkVals),
    };
  };
  const setValues = (p = {}) => {
    applyTitleAlbum(f, p);
    credits.set(p);
    wiki.set({ song: p.wikipedia_song, artist: p.wikipedia_artist, album: p.wikipedia_album });
    links.paintIcons();
    emit();
  };

  return {
    node,
    values,
    linkProblems: () => links.problems(),
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
      links.reset();
      ident.reset();
      meta.reset();
      orig.forget();
      meta.restoreButton();
      trim.reset();
      tc.clearRestored();
      tc.paintCleaned(first.removed);
      labels.set(labelsOf(initial));
      setValues(initialValues(initial, startTitle));
      credits.resetYear(initial.published_year);
    },
    destroy() {
      abortAll();
      ident.destroy();
    },
  };
}
