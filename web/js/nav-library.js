import { can } from './guest.js';
import { isSignedIn } from './api.js';
import { storeGet, storeSet } from './storage.js';

export const LIBRARY_VIEW_KEY = 'electrophone.libraryView';
const SUBVIEWS = { 'library/albums': 'albums', 'library/drafts': 'drafts' };

export const libraryViewOf = (navName) => SUBVIEWS[navName] || 'songs';

export function savedLibraryView() {
  const v = storeGet(LIBRARY_VIEW_KEY);
  if (v === 'albums' || v === 'drafts') return can('drafts') ? v : 'songs';
  return 'songs';
}

export function saveLibraryView(navName) {
  const v = libraryViewOf(navName);
  if (v !== 'songs' && !can('drafts')) return;
  storeSet(LIBRARY_VIEW_KEY, v);
}

export function libraryHashFor(view) {
  if (view === 'albums') return '#/library/albums';
  return view === 'drafts' ? '#/library/drafts' : '#/library';
}

/** The hash to open instead of a bare #/library on the first load: the last chosen sub-item, or null for Songs. */
export function initialLibraryRedirect() {
  const v = savedLibraryView();
  return v === 'songs' ? null : libraryHashFor(v);
}

let subscribed = false;

function paintCount(draftStore, doc) {
  const badge = doc.getElementById('nav-drafts-count');
  if (!badge) return;
  badge.textContent = draftStore.loaded ? String(draftStore.count) : '';
  const link = badge.closest('a');
  link?.setAttribute('aria-label', draftStore.loaded ? `Drafts, ${draftStore.count}` : 'Drafts');
}

export function syncLibraryMenu(draftStore, doc = document) {
  const drafting = can('drafts');
  for (const route of ['library/albums', 'library/drafts']) {
    const li = doc.querySelector(`#library-sub a[data-route="${route}"]`)?.closest('li');
    if (li) li.hidden = !drafting;
  }
  if (!subscribed) {
    subscribed = true;
    draftStore.subscribe(() => paintCount(draftStore, doc));
  }
  if (drafting && isSignedIn() && !draftStore.loaded) void draftStore.load();
  paintCount(draftStore, doc);
}
