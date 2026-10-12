

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
const hasTag = (song, tag) => (song.tags || []).some((t) => lc(t) === lc(tag));

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
  return { state: { ...state, items, index: state.index < 0 ? 0 : state.index }, result: state.index < 0 ? 'queued' : 'added' };
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
    if (it) {
      for (const m of matched) if (!it.tags.some((t) => lc(t) === lc(m))) it.tags.push(m);
    } else {
      items.push({ id: s.id, manual: false, tags: matched });
      added += 1;
    }
  }
  return { state: { items, index: state.index < 0 && items.length ? 0 : state.index, tags }, added };
}

// Drops chips and the not-yet-started, non-manual songs that only those chips contributed.
export function removeTags(state, remove) {
  const rm = remove.map(lc);
  const tags = state.tags.filter((t) => !rm.includes(lc(t)));
  let removed = 0;
  const items = [];
  state.items.forEach((it, i) => {
    const left = it.tags.filter((t) => !rm.includes(lc(t)));
    if (i > state.index && !it.manual && left.length === 0) { removed += 1; return; }
    items.push({ ...it, tags: left });
  });
  return { state: { items, index: state.index, tags }, removed };
}

export const clean = (state) => removeTags(state, state.tags);

export function removeAt(state, i) {
  if (i <= state.index || i >= state.items.length) return state;
  return { ...state, items: state.items.filter((_, k) => k !== i) };
}

export function move(state, i, delta) {
  const j = i + delta;
  if (i <= state.index || j <= state.index || j >= state.items.length) return state;
  const items = [...state.items];
  [items[i], items[j]] = [items[j], items[i]];
  return { ...state, items };
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
  const index = Number.isInteger(data.index) && data.index >= 0 && data.index < items.length ? data.index : (items.length ? 0 : -1);
  return { items, index, tags };
}
