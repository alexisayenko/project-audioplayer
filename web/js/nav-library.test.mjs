import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { savedLibraryView, saveLibraryView, libraryViewOf, libraryHashFor, initialLibraryRedirect, LIBRARY_VIEW_KEY } = await import('./nav-library.js');
const guest = await import('./guest.js');

test('views, hashes and the key', () => {
  assert.equal(LIBRARY_VIEW_KEY, 'electrophone.libraryView');
  assert.equal(libraryViewOf('library/albums'), 'albums');
  assert.equal(libraryViewOf('library/drafts'), 'drafts');
  assert.equal(libraryViewOf('library'), 'songs');
  assert.equal(libraryHashFor('albums'), '#/library/albums');
  assert.equal(libraryHashFor('songs'), '#/library');
});

test('restore: a remembered sub-item is returned and Songs means no redirect', () => {
  localStorage.setItem(LIBRARY_VIEW_KEY, 'drafts');
  assert.equal(savedLibraryView(), 'drafts');
  assert.equal(initialLibraryRedirect(), '#/library/drafts');
  localStorage.setItem(LIBRARY_VIEW_KEY, 'songs');
  assert.equal(initialLibraryRedirect(), null);
  localStorage.setItem(LIBRARY_VIEW_KEY, 'bogus');
  assert.equal(savedLibraryView(), 'songs');
  localStorage.removeItem(LIBRARY_VIEW_KEY);
  assert.equal(savedLibraryView(), 'songs');
});

test('guest fallback: a remembered Albums or Drafts is ignored and not overwritten', () => {
  localStorage.setItem(LIBRARY_VIEW_KEY, 'albums');
  guest.setGuest({ guest: true, audio: true });
  try {
    assert.equal(savedLibraryView(), 'songs');
    assert.equal(initialLibraryRedirect(), null);
    saveLibraryView('library/drafts');
    assert.equal(localStorage.getItem(LIBRARY_VIEW_KEY), 'albums');
    saveLibraryView('library');
    assert.equal(localStorage.getItem(LIBRARY_VIEW_KEY), 'songs');
  } finally {
    guest.clearGuest();
  }
});

test('storage that throws never breaks the page', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.equal(savedLibraryView(), 'songs');
    assert.equal(initialLibraryRedirect(), null);
    assert.doesNotThrow(() => saveLibraryView('library/albums'));
  } finally {
    Object.defineProperty(globalThis, 'localStorage', real);
  }
});
