import { api } from './api.js';
import { normalType } from './album-draft-model.js';
import { artistName, searchKey, isConfident, buildReview, genresPayload, initialGenres, parseRym, discogsLabels } from './album-wizard-model.js';

export const DISCOGS_ERRORS = {
  discogs_unavailable: 'Discogs search is not set up on this server.',
  discogs_failed: 'Discogs could not be reached. Try again later.',
};
export const NO_DISCOGS = 'No match on Discogs. You can go on without it.';
export const RESOLVE_FAILED = 'Discogs could not be read for this album. Pick another one or choose None of these.';

const clearDownstream = (draft) => {
  draft.review = null;
  draft.art.chosen = null;
  draft.genreHints = { key: '', state: 'idle', items: [], page: null, error: '' };
};

export function setPick(draft, pick) {
  const same = draft.discogs.pick === pick || (pick && pick !== 'none' && draft.discogs.pick?.id === pick.id && draft.discogs.pick?.kind === pick.kind);
  if (same) return false;
  draft.discogs.pick = pick;
  draft.discogs.resolved = null;
  if (!draft.touched.labels) draft.album.labels = [];
  clearDownstream(draft);
  return true;
}

export async function searchDiscogs(draft, { all = false, find = api.albumDiscogsFind } = {}) {
  const f = draft.fields;
  draft.discogs.state = 'loading';
  let res;
  try {
    res = await find({ artist: artistName(f.artist), title: f.album.trim(), year: Number(f.year) || null, ...(all ? { all: true } : {}) });
  } catch {
    res = { candidates: [], searchError: 'discogs_failed' };
  }
  const found = Array.isArray(res?.candidates) ? res.candidates : [];
  Object.assign(draft.discogs, {
    state: 'done', all, key: searchKey(f), candidates: found,
    error: found.length ? '' : (DISCOGS_ERRORS[res?.searchError] || NO_DISCOGS),
  });
  return draft.discogs;
}

export async function resolveLink(link, { resolve = api.albumDiscogsResolve } = {}) {
  let res;
  try {
    res = await resolve({ kind: link.kind, id: link.id });
  } catch (ex) {
    return { ok: false, error: ex?.status === 0 ? 'unreachable' : 'discogs_failed' };
  }
  const row = res?.candidate;
  if (!row || !Array.isArray(row.tracks)) return { ok: false, error: res?.searchError || 'discogs_failed' };
  return { ok: true, candidate: { ...row, kind: row.kind || link.kind, id: row.id ?? link.id } };
}

export async function resolvePick(draft, candidate, { resolve = api.albumDiscogsResolve, full: known = null } = {}) {
  if (candidate === 'none') {
    setPick(draft, 'none');
    return true;
  }
  const have = draft.discogs.pick;
  if (have && have !== 'none' && have.id === candidate.id && have.kind === candidate.kind && draft.discogs.resolved) return true;
  let full = known;
  if (!full) {
    let res;
    try {
      res = await resolve({ kind: candidate.kind, id: candidate.id });
    } catch {
      return false;
    }
    full = res?.candidate;
  }
  if (!full) return false;
  setPick(draft, candidate);
  draft.discogs.pick = candidate;
  draft.discogs.resolved = { ...candidate, ...full };
  if (!draft.touched.labels) draft.album.labels = discogsLabels(draft.discogs.resolved);
  if (draft.discogs.resolved.type && !draft.touched.type) draft.album.type = normalType(draft.discogs.resolved.type);
  if (!draft.fields.year.trim() && draft.discogs.resolved.year) draft.fields.year = String(draft.discogs.resolved.year);
  buildReview(draft);
  return true;
}

export async function runDetails(draft, deps = {}) {
  const key = searchKey(draft.fields);
  if (draft.discogs.key !== key) {
    draft.discogs = { key: '', state: 'idle', all: false, candidates: [], error: '', pick: null, resolved: null, auto: false, linked: null };
    clearDownstream(draft);
    await searchDiscogs(draft, deps);
  }
  if (draft.discogs.pick) return draft.discogs.auto ? 'review' : 'discogs';
  const sure = draft.discogs.all ? null : isConfident(draft.discogs.candidates, draft.fields);
  if (sure && await resolvePick(draft, sure, deps)) {
    draft.discogs.auto = true;
    return 'review';
  }
  return 'discogs';
}

export async function suggestGenres(draft, { rymText = '', suggest = api.albumGenresSuggest } = {}) {
  const pick = draft.discogs.pick;
  const key = [searchKey(draft.fields), pick && pick !== 'none' ? `${pick.kind}${pick.id}` : 'none'].join('|');
  if (!rymText && draft.genreHints.key === key && draft.genreHints.state === 'done') return draft.genreHints;
  const hints = draft.genreHints;
  hints.state = 'loading';
  let res = null;
  try {
    res = await suggest(genresPayload(draft, rymText));
  } catch {
    hints.error = 'Genre suggestions are not available right now. Add genres by hand.';
  }
  if (res) {
    const incoming = Array.isArray(res.suggestions) ? res.suggestions : [];
    const isRym = (i) => i.source === 'rym';
    hints.items = rymText
      ? [...incoming.filter(isRym), ...hints.items.filter((i) => !isRym(i))]
      : [...hints.items.filter(isRym), ...incoming.filter((i) => !isRym(i))];
    hints.page = res.wikipediaPage || hints.page || null;
    hints.error = res.searchError ? 'Wikipedia could not be reached, so its genres are missing.' : '';
  }
  hints.key = rymText ? hints.key : key;
  hints.state = 'done';
  return hints;
}

export function applyRym(draft, text) {
  const parsed = parseRym(text);
  if (parsed.url) draft.rym.url = parsed.url;
  return parsed;
}

export function seedGenres(draft) {
  if (draft.touched.genres) return draft.album.genres;
  const seeded = initialGenres(draft);
  draft.album.genres = seeded;
  return seeded;
}
