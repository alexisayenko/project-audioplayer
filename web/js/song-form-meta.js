import { api } from './api.js';
import { el } from './dom.js';
import { planMetadata, metaMessage, serviceState, suggestion, suggestionText } from './metadata-apply.js';
import { metadataBody, sourceList, artistString } from './song-payload.js';
import { suggestedGenres } from './suggested-genres.js';

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

function versionedStates(states, versioned) {
  if (!versioned) return states;
  return { ...states, musicbrainz: { on: false, url: null }, discogs: { on: false, url: null } };
}

function mergeMetadataUrls(states, mbUrl, discogsUrl) {
  return {
    mbUrl: states.musicbrainz.url || mbUrl,
    discogsUrl: states.discogs.url && !discogsUrl ? states.discogs.url : discogsUrl,
  };
}

function hintView(suggest, cur) {
  const sug = suggest ? suggestion(suggest, cur()) : null;
  return { hidden: !sug, text: sug ? `Wikipedia says: ${suggestionText(sug, cur())}` : '' };
}

function applySuggestion(f, sug) {
  if (sug.artist) f.artists.value = sug.artist;
  if (sug.title) f.title.value = sug.title;
}

const whenLive = (req, fn) => { if (req.live()) fn(); };

export function metadataSection({ f, credits, editor, wiki, links, orig, source, begin, emit }) {
  const metaBtn = el('button', { class: 'btn outline small', type: 'button' }, 'Get metadata');
  const metaMsg = el('p', { class: 't-caption muted', role: 'status' });
  const hint = el('button', { class: 'link-btn t-caption wiki-hint', type: 'button', hidden: true });
  let suggest = null;
  let discogsState = null;
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

  const restoreButton = () => {
    metaBtn.disabled = false;
    metaBtn.textContent = 'Get metadata';
  };
  const reset = () => {
    suggest = null;
    discogsState = null;
    links.resetIcons();
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
  const finish = (resp) => {
    links.icons.setBusy(false);
    const states = versionedStates(serviceState(resp?.services), credits.hasVersion());
    Object.assign(links.state, mergeMetadataUrls(states, links.state.mbUrl, links.state.discogsUrl));
    discogsState = states.discogs;
    links.state.lastStates = states;
    links.paintIcons();
    suggest = resp?.suggest || null;
    applyMeta(resp);
    paintHint();
  };
  const fail = () => {
    links.resetIcons();
    metaMsg.textContent = 'Couldn\'t load metadata';
  };
  metaBtn.addEventListener('click', async () => {
    const wv = wiki.values();
    const body = metadataBody({ title: f.title.value, ...credits.values(), ...wv, discogs_url: links.state.discogsUrl }, sourceList(typeof source === 'function' ? source() : source));
    const req = begin();
    reset();
    metaBtn.disabled = true;
    metaBtn.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Getting metadata...');
    links.icons.setBusy(true);
    try {
      const resp = await api.metadata(body, req.signal);
      whenLive(req, () => finish(resp));
    } catch {
      whenLive(req, fail);
    } finally {
      req.done();
      whenLive(req, restoreButton);
    }
  });
  return { metaBtn, metaMsg, hint, reset, restoreButton };
}
