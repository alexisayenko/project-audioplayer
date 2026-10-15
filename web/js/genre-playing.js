import { tagLabel } from './tagname.js';

const normValue = (v) => String(v).trim().toLowerCase().replace(/\s+/g, ' ');

export function songGenres(song) {
  const seen = new Set();
  const out = [];
  for (const t of song?.tags || []) {
    const i = String(t).indexOf(':');
    if (i <= 0 || t.slice(0, i).trim().toLowerCase() !== 'genre') continue;
    const key = normValue(t.slice(i + 1));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ tag: `genre:${key}`, key, label: tagLabel(`genre:${key}`) });
  }
  return out;
}

const owners = new WeakMap();

function ownerMap(g) {
  let owner = g && typeof g === 'object' ? owners.get(g) : null;
  if (owner) return owner;
  owner = new Map();
  for (const n of g?.nodes || []) {
    for (const k of n.tags?.length ? n.tags : [n.label.toLowerCase()]) owner.set(normValue(k), n.id);
  }
  if (g && typeof g === 'object') owners.set(g, owner);
  return owner;
}

export function mapToNodes(genres, g) {
  const owner = ownerMap(g);
  return genres.map((x) => ({ ...x, id: owner.get(x.key) || null }));
}

export const nodeIds = (items) => [...new Set(items.map((x) => x.id).filter(Boolean))];

export function nowPlayingState(song, items) {
  if (!song) return { kind: 'idle', hint: 'Nothing playing' };
  if (!items.length) return { kind: 'none', hint: 'No genres for this song' };
  if (!nodeIds(items).length) return { kind: 'unmapped', hint: 'None of this song\'s genres are on the map' };
  return { kind: 'ready', hint: 'Select the genres of the playing song' };
}

export const nowSelectionMessage = (n) => `Selected ${n} ${n === 1 ? 'genre' : 'genres'} of the playing song`;

export function createNowSelection({ setSelection, clearSelection, announce = () => {} }) {
  let active = false;
  let busy = false;
  let key = '';
  const apply = (ids) => {
    busy = true;
    try { setSelection(ids); } finally { busy = false; }
    announce(nowSelectionMessage(ids.length));
  };
  const drop = () => {
    active = false;
    busy = true;
    try { clearSelection(); } finally { busy = false; }
  };
  return {
    get active() { return active; },
    toggle(ids) {
      if (active) { drop(); return false; }
      if (!ids.length) return false;
      active = true;
      key = ids.join('|');
      apply(ids);
      return true;
    },
    songChanged(ids) {
      if (!active) return;
      if (!ids.length) { drop(); return; }
      const k = ids.join('|');
      if (k === key) return;
      key = k;
      apply(ids);
    },
    userSelected() {
      if (busy) return false;
      const was = active;
      active = false;
      return was;
    },
  };
}
