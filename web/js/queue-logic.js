import { canonicalTag } from './tagname.js';


// Returns { index, played } for the song to play next, or null to stop.
// `played` is the list of ids already played in the current shuffle round.
// manual: true for the Next button (repeat "one" does not pin it to the same song).
export function nextStep({ queue, index, shuffle, repeat, played = [] }, manual, rand = Math.random) {
  const n = queue.length;
  if (n === 0 || index < 0 || index >= n) return null;
  const cur = queue[index];
  let seen = played.includes(cur) ? played : [...played, cur];
  if (repeat === 'one' && !manual) return { index, played: seen };
  if (shuffle) {
    let cand = queue.map((id, i) => i).filter((i) => !seen.includes(queue[i]));
    if (!cand.length) {
      if (repeat !== 'all') return null;
      seen = [cur];
      cand = queue.map((id, i) => i).filter((i) => i !== index);
      if (!cand.length) return { index, played: seen };
    }
    const pick = cand[Math.min(cand.length - 1, Math.floor(rand() * cand.length))];
    return { index: pick, played: seen };
  }
  if (index + 1 < n) return { index: index + 1, played: seen };
  if (repeat === 'all') return { index: 0, played: seen };
  return null;
}

export function hasNext(state) {
  return nextStep(state, true, () => 0) !== null;
}

// Returns { index, history } for the previous song, or null (restart the current one).
// In shuffle mode "previous" walks back through the songs actually played.
export function prevStep({ queue, index, shuffle, history = [] }) {
  if (shuffle) {
    const rest = [...history];
    while (rest.length) {
      const id = rest.pop();
      const at = queue.indexOf(id);
      if (at >= 0 && at !== index) return { index: at, history: rest };
    }
    return null;
  }
  return index > 0 ? { index: index - 1, history } : null;
}

const lc = (s) => s.toLocaleLowerCase();
const hasTag = (song, tag) => (song.tags || []).some((t) => lc(canonicalTag(t)) === lc(canonicalTag(tag)));

// Queue state: { items: [{ id, manual, tags }], index, tags }.
// `tags` are the selected tag chips; an item's `tags` are the chips that brought it in.
// An item is "manual" when added one by one (Library Add / Play now); manual wins over tags.
export function emptyState() {
  return { items: [], index: -1, tags: [] };
}

export const queueIds = (state) => state.items.map((it) => it.id);

export function toggleRepeat(current, target) {
  return current === target ? 'off' : target;
}

export function addManual(state, id) {
  const at = state.items.findIndex((it) => it.id === id);
  if (at >= 0) {
    if (state.items[at].manual) return { state, result: 'duplicate' };
    const items = state.items.map((it, i) => (i === at ? { ...it, manual: true } : it));
    return { state: { ...state, items }, result: 'added' };
  }
  const items = [...state.items, { id, manual: true, tags: [] }];
  return { state: { ...state, items, index: Math.max(state.index, 0) }, result: state.index < 0 ? 'queued' : 'added' };
}

export function playNow(state, id) {
  const items = [...state.items];
  let index = state.index;
  const at = items.findIndex((it) => it.id === id);
  let item = { id, manual: true, tags: [] };
  if (at >= 0) {
    item = { ...items.splice(at, 1)[0], manual: true };
    if (at <= index) index -= 1;
  }
  index += 1;
  items.splice(index, 0, item);
  return { ...state, items, index };
}

function mergeTags(item, tags) {
  for (const m of tags) if (!item.tags.some((t) => lc(t) === lc(m))) item.tags.push(m);
}

// Union add: every song carrying ANY picked tag is appended (deduped); picked tags become chips.
export function addTags(state, picks, songs) {
  const tags = [...state.tags];
  for (const p of picks) if (!tags.some((t) => lc(t) === lc(p))) tags.push(p);
  const items = state.items.map((it) => ({ ...it, tags: [...it.tags] }));
  let added = 0;
  for (const s of songs) {
    const matched = picks.filter((p) => hasTag(s, p));
    if (!matched.length) continue;
    const it = items.find((x) => x.id === s.id);
    if (it) mergeTags(it, matched);
    else {
      items.push({ id: s.id, manual: false, tags: matched });
      added += 1;
    }
  }
  return { state: { items, index: state.index < 0 && items.length ? 0 : state.index, tags }, added };
}

// Library "Add all": the listed songs go in deduped at the end. With a tag filter the tag becomes a chip (as addTags);
// without one (search only) they are added as manual. `already` counts listed songs that were in the queue before.
export function addListed(state, songs, tag = '') {
  const before = new Set(state.items.map((it) => it.id));
  const already = songs.filter((s) => before.has(s.id)).length;
  if (tag) {
    const r = addTags(state, [tag], songs);
    return { state: r.state, added: r.added, already };
  }
  let next = state;
  let added = 0;
  for (const s of songs) {
    if (before.has(s.id)) continue;
    next = addManual(next, s.id).state;
    added += 1;
  }
  return { state: next, added, already };
}

// Library "Play all": the queue is REPLACED by the listed songs (deduped, list order). With tag filters the tags become
// chips and the items tag-derived; search-only gives manual items. Start index is 0, or random when shuffle is on.
export function playListed(state, songs, tags = [], shuffle = false, rand = Math.random) {
  const seen = new Set();
  const list = songs.filter((s) => !seen.has(s.id) && seen.add(s.id));
  if (!list.length) return { state, count: 0, replaced: false };
  const items = list.map((s) => {
    const matched = tags.filter((t) => hasTag(s, t));
    return matched.length ? { id: s.id, manual: false, tags: matched } : { id: s.id, manual: true, tags: [] };
  });
  const index = shuffle ? Math.min(items.length - 1, Math.floor(rand() * items.length)) : 0;
  const replaced = state.items.length > state.index + 1;
  return { state: { items, index, tags: [...tags] }, count: items.length, replaced };
}

// Drops chips and the not-yet-started, non-manual songs that only those chips contributed.
export function removeTags(state, remove) {
  const rm = new Set(remove.map(lc));
  const tags = state.tags.filter((t) => !rm.has(lc(t)));
  let removed = 0;
  const items = [];
  state.items.forEach((it, i) => {
    const left = it.tags.filter((t) => !rm.has(lc(t)));
    if (i > state.index && !it.manual && left.length === 0) { removed += 1; return; }
    items.push({ ...it, tags: left });
  });
  return { state: { items, index: state.index, tags }, removed };
}

export const clean = (state) => removeTags(state, state.tags);

// Removes the row at i. The current song is followed by identity: a row before it shifts the index down.
// Removing the current row makes the row that slid into its place current (the last row if it was last; -1 if none left)
// and reports currentRemoved so the caller can advance to a playable song or stop.
export function removeItem(state, i) {
  if (!Number.isInteger(i) || i < 0 || i >= state.items.length) return { state, currentRemoved: false };
  const items = state.items.filter((_, k) => k !== i);
  const currentRemoved = i === state.index;
  let index = state.index;
  if (i < index) index -= 1;
  else if (currentRemoved) index = Math.min(i, items.length - 1);
  return { state: { ...state, items, index }, currentRemoved };
}

// Swaps the row at i with its neighbour (delta -1 or +1); the current song stays current wherever it lands.
export function moveItem(state, i, delta) {
  const j = i + delta;
  if (!Number.isInteger(i) || i < 0 || i >= state.items.length || j < 0 || j >= state.items.length) return state;
  const items = [...state.items];
  [items[i], items[j]] = [items[j], items[i]];
  let index = state.index;
  if (index === i) index = j;
  else if (index === j) index = i;
  return { ...state, items, index };
}

export function syncLibrary(state, exists) {
  const cur = state.items[state.index];
  const curGone = !!cur && !exists(cur.id);
  const items = state.items.filter((it) => exists(it.id));
  if (items.length === state.items.length) return { state, curGone: false };
  const before = state.items.slice(0, state.index).filter((it) => exists(it.id)).length;
  return { state: { ...state, items, index: items.length ? Math.min(before, items.length - 1) : -1 }, curGone };
}

export function parseSaved(data) {
  if (!data || typeof data !== 'object') return emptyState();
  let items = [];
  if (Array.isArray(data.items)) {
    items = data.items
      .filter((it) => it && typeof it.id === 'string')
      .map((it) => ({ id: it.id, manual: it.manual !== false, tags: Array.isArray(it.tags) ? it.tags.filter((t) => typeof t === 'string') : [] }));
  } else if (Array.isArray(data.ids) && data.ids.every((x) => typeof x === 'string')) {
    items = data.ids.map((id) => ({ id, manual: true, tags: [] }));
  }
  items = items.filter((it, i) => items.findIndex((x) => x.id === it.id) === i);
  const tags = Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === 'string') : [];
  const valid = Number.isInteger(data.index) && data.index >= 0 && data.index < items.length;
  const fallback = items.length ? 0 : -1;
  const index = valid ? data.index : fallback;
  return { items, index, tags };
}

export const upcomingCount = (state) => Math.max(0, state.items.length - Math.max(state.index, -1) - 1);

// Queue "Clear": drops every song after the current one and all tag chips; the current and earlier songs stay.
export function clearUpcoming(state) {
  const keep = Math.max(state.index, -1) + 1;
  const removed = Math.max(0, state.items.length - keep);
  const items = state.items.slice(0, keep).map((it) => ({ ...it, tags: [] }));
  return { state: { items, index: state.index, tags: [] }, removed };
}

export const queuedSet = (state) => new Set(state.items.map((it) => it.id));

function shufflePlayable({ queue, index, repeat }, ok, seen0, rand) {
  const playable = queue.map((id, i) => i).filter((i) => i !== index && ok(queue[i]));
  let cand = playable.filter((i) => !seen0.includes(queue[i]));
  let seen = seen0;
  if (!cand.length) {
    if (repeat !== 'all' || !playable.length) return null;
    seen = [queue[index]];
    cand = playable;
  }
  const pick = cand[Math.min(cand.length - 1, Math.floor(rand() * cand.length))];
  return { index: pick, played: seen, skipped: 0 };
}

// Next song that can play. `ok(id)` says whether an id has audio; with `autoOn` (Auto-download) every song counts
// and this is a plain nextStep. Returns { index, played, skipped } or null (no playable song that way: stop).
// Sequential mode steps over songs without audio and counts them in `skipped`; shuffle only draws playable songs.
export function nextPlayable(state, manual, ok, autoOn, rand = Math.random) {
  if (autoOn) {
    const s = nextStep(state, manual, rand);
    return s && { ...s, skipped: 0 };
  }
  const { queue, index, shuffle, repeat } = state;
  const n = queue.length;
  if (n === 0 || index < 0 || index >= n) return null;
  const cur = queue[index];
  const seen0 = (state.played || []).includes(cur) ? state.played : [...(state.played || []), cur];
  if (repeat === 'one' && !manual) return { index, played: seen0, skipped: 0 };
  if (shuffle) return shufflePlayable(state, ok, seen0, rand);
  let at = index;
  let seen = state.played || [];
  let skipped = 0;
  for (let n = queue.length; n > 0; n--) {
    const step = nextStep({ ...state, index: at, played: seen }, true, rand);
    if (!step) return null;
    seen = step.played;
    if (ok(queue[step.index])) return { index: step.index, played: seen, skipped };
    skipped += 1;
    at = step.index;
  }
  return null;
}

// Previous playable song: { index, history, skipped } or null (the caller restarts the current song).
export function prevPlayable(state, ok, autoOn) {
  if (autoOn) {
    const s = prevStep(state);
    return s && { ...s, skipped: 0 };
  }
  let at = state.index;
  let hist = state.history || [];
  let skipped = 0;
  for (let n = state.queue.length; n > 0; n--) {
    const step = prevStep({ ...state, index: at, history: hist });
    if (!step) return null;
    hist = step.history;
    if (ok(state.queue[step.index])) return { index: step.index, history: hist, skipped };
    skipped += 1;
    at = step.index;
  }
  return null;
}
