import { el, toast } from './dom.js';
import { beginClickLoad } from './load-gate.js';

export const PENDING_DELAY_MS = 150;
const NOTE_MS = 2000;
export const STALE_TEXT = 'This page is out of date. Reload to continue.';

async function checkStale() {
  try { return await (await import('./update-check.js')).checkNow(); } catch { return false; }
}

export const UI_LOADERS = {
  songCard: () => import('./song-card.js'),
  add: () => import('./add.js'),
  edit: () => import('./edit-dialog.js'),
  cover: () => import('./cover-dialog.js'),
  share: () => import('./share-ui.js'),
  shareOpen: () => import('./share-open.js'),
  tagPicker: () => import('./player-tag-picker.js'),
  drafts: () => import('./drafts.js'),
  actions: () => import('./player-actions.js'),
  filters: () => import('./library-toolbar.js'),
};

const loading = new Map();

export function loadUi(name, loaders = UI_LOADERS) {
  if (!loading.has(name)) {
    const p = loaders[name]();
    loading.set(name, p);
    p.catch(() => { if (loading.get(name) === p) loading.delete(name); });
  }
  return loading.get(name);
}

function noteAfter(opener, text, kind) {
  if (!opener?.isConnected || opener.closest?.('.mini')) return null;
  const note = el('span', { class: `ui-note muted t-caption ${kind}`, role: 'status', 'aria-live': 'polite' }, text);
  opener.after(note);
  return note;
}

/** Load a UI module on demand and run `use` with it; a slow load shows a small inline note next to `opener` (WEB-115). */
export async function withUi(name, opener, use, loaders = UI_LOADERS) {
  let note = null;
  const end = beginClickLoad();
  const timer = setTimeout(() => {
    opener?.setAttribute('aria-busy', 'true');
    note = noteAfter(opener, 'Loading...', 'pending');
  }, PENDING_DELAY_MS);
  const settle = () => {
    clearTimeout(timer);
    end();
    opener?.removeAttribute('aria-busy');
    note?.remove();
  };
  let mod;
  try {
    try { mod = await loadUi(name, loaders); } catch { mod = await loadUi(name, loaders); }
  } catch {
    settle();
    if (await checkStale()) {
      toast(STALE_TEXT, { label: 'Reload', run: () => globalThis.location?.reload() });
      return undefined;
    }
    const fail = noteAfter(opener, 'Could not load. Try again.', 'error');
    if (fail) setTimeout(() => fail.remove(), NOTE_MS);
    else toast('Could not load. Try again.');
    return undefined;
  }
  settle();
  return use(mod);
}

export const openSongCard = (song, opener = null) => withUi('songCard', opener, (m) => m.openSongCard(song, opener));
export const openAdd = (opts, opener = null) => withUi('add', opener, (m) => m.openAdd(opts));
export const editDialog = (song, opener = null) => withUi('edit', opener, (m) => m.editDialog(song));
export const changeCover = (song, opener = null) => withUi('cover', opener, (m) => m.openCoverDialog(song, opener));
export const openShareDialog = (song, opener = null) => withUi('share', opener, (m) => m.openShareDialog(song));
export const openTagPicker = (player, currentTags, opener = null) => withUi('tagPicker', opener, (m) => m.openTagPicker(player, currentTags));
export const openFilterSheet = (cat, opener, onApply) => withUi('filters', opener, (m) => m.openFilterSheet(cat, opener, onApply));
