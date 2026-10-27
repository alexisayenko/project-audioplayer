import { el } from './dom.js';
import { linksPanel } from './links-panel.js';
import { storedLinkStates, wikipediaLink, linkError, linkErrors, ownSourceKind } from './song-links.js';
import { serviceState } from './metadata-apply.js';

const httpsOrNull = (u) => (/^https:\/\/\S+$/i.test(u || '') ? u : null);

function wikiEntry(wv) {
  return wikipediaLink(wv) || (httpsOrNull(wv.wikipedia_album) ? { url: wv.wikipedia_album, label: 'Wikipedia (album)' } : null);
}

function mergeLiveStates(out, base, lastStates) {
  for (const [k, v] of Object.entries(lastStates)) {
    if (v.on) out[k] = { ...base[k], ...v, url: v.url ?? base[k]?.url ?? null };
  }
}

const linkInput = (v) => el('input', { type: 'text', value: v || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });

const setUnlessFocused = (inp, value) => {
  if (globalThis.document?.activeElement !== inp) inp.value = value || '';
};

export const discogsOf = (s) => s.discogs_url ?? null;

const initialMb = (initial) => serviceState({ musicbrainz: { found: true, url: initial.musicbrainz_url } }).musicbrainz.url;

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

function bindSrcInputs({ srcInp, linkVals, panel, own, paintIcons }) {
  for (const k of Object.keys(srcInp)) {
    srcInp[k].addEventListener('input', () => { linkVals[k] = srcInp[k].value.trim() || null; panel.setErrors(linkErrors(linkVals, { ownKind: own })); paintIcons(); });
  }
}

function withoutOwnLinks(errors, isAdd) {
  if (isAdd) {
    delete errors.youtube;
    delete errors.soundcloud;
  }
  return errors;
}

export const ownLinkUrls = (isAdd, linkVals) => (isAdd ? {} : { youtube_url: linkVals.youtube, soundcloud_url: linkVals.soundcloud });

export function linkSection({ isAdd, initial, wiki }) {
  const state = { mbUrl: initialMb(initial), discogsUrl: discogsOf(initial), lastStates: {} };
  const own = isAdd ? null : ownSourceKind(initial);
  const storedLinks = storedLinkStates(initial);
  const linkVals = storedLinkValues(initial, storedLinks);
  const stored = () => storedStates(initial, state.mbUrl, state.discogsUrl);
  const mbInp = linkInput(state.mbUrl);
  const dcInp = linkInput(state.discogsUrl);
  const srcInp = { youtube: linkInput(linkVals.youtube), soundcloud: linkInput(linkVals.soundcloud), spotify: linkInput(linkVals.spotify) };
  const wf = wiki.fields;
  const panel = linksPanel({
    inputs: { wikipedia_song: wf.song.inp, wikipedia_artist: wf.artist.inp, wikipedia_album: wf.album.inp, musicbrainz: mbInp, discogs: dcInp, ...srcInp },
    ...panelOptions(isAdd),
  });
  const icons = panel.summary;
  const paintIcons = () => {
    const wv = wiki.values();
    const out = iconStates({ base: stored(), lastStates: state.lastStates, wv, mbUrl: state.mbUrl, discogsUrl: state.discogsUrl, linkVals, srcInp, isAdd });
    setUnlessFocused(mbInp, state.mbUrl);
    setUnlessFocused(dcInp, state.discogsUrl);
    panel.paint({
      youtube: out.youtube?.url ?? '', soundcloud: out.soundcloud?.url ?? '', spotify: out.spotify?.url ?? '',
      wikipedia_song: wv.wikipedia_song, wikipedia_artist: wv.wikipedia_artist, wikipedia_album: wv.wikipedia_album,
      musicbrainz: state.mbUrl, discogs: state.discogsUrl,
    }, out);
  };
  const fromInput = (inp) => (inp.value.trim() || null);
  mbInp.addEventListener('input', () => { state.mbUrl = fromInput(mbInp); paintIcons(); });
  dcInp.addEventListener('input', () => { state.discogsUrl = fromInput(dcInp); paintIcons(); });
  bindSrcInputs({ srcInp, linkVals, panel, own, paintIcons });
  for (const r of Object.values(wf)) r.inp.addEventListener('input', paintIcons);
  const resetIcons = () => {
    state.lastStates = {};
    icons.reset();
    paintIcons();
  };
  resetIcons();
  return {
    state,
    linkVals,
    panel,
    icons,
    paintIcons,
    resetIcons,
    problems() {
      const errors = withoutOwnLinks(linkErrors(linkVals, { ownKind: own }), isAdd);
      panel.setErrors(errors);
      return Object.values(errors)[0] || null;
    },
    reset() {
      state.mbUrl = initialMb(initial);
      state.discogsUrl = discogsOf(initial);
      Object.assign(linkVals, storedLinkValues(initial, storedLinks));
      panel.setErrors({});
    },
  };
}
