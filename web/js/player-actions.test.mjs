import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
const g = await import('./guest.js');
initPlayer();
const { serviceButtons, paintServiceButtons } = await import('./player-actions.js');

const YT = 'https://www.youtube.com/watch?v=abc';
const SC = 'https://soundcloud.com/a/b';
const both = { id: 'a', title: 'A', file: 'a.mp3', tags: [], sources: [{ url: YT }, { url: SC }] };
const none = { id: 'n', title: 'N', file: null, audio_state: 'none', tags: [], source_url: 'https://example.com/x' };
const $ = (id) => document.getElementById(id);

test('serviceButtons lists only YouTube and SoundCloud links the song has', () => {
  assert.deepEqual(serviceButtons(both).map((b) => [b.kind, b.url, b.label]), [
    ['youtube', YT, 'Open on YouTube'], ['soundcloud', SC, 'Open on SoundCloud']]);
  assert.deepEqual(serviceButtons({ ...none, source_url: SC }).map((b) => b.kind), ['soundcloud']);
  assert.deepEqual(serviceButtons(none), []);
  assert.deepEqual(serviceButtons(null), []);
});

test('paintServiceButtons builds new-tab links with safe rel and hides an empty host', () => {
  const host = document.createElement('span');
  paintServiceButtons(host, both);
  assert.equal(host.hidden, false);
  const a = host.children[0];
  assert.equal(a.href, YT);
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener noreferrer');
  assert.equal(a.getAttribute('aria-label'), 'Open on YouTube');
  paintServiceButtons(host, { ...none, source_url: null });
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
});

test('a source that is neither YouTube nor SoundCloud gets one generic Open source button', () => {
  const host = document.createElement('span');
  paintServiceButtons(host, none);
  assert.equal(host.hidden, false);
  assert.equal(host.children.length, 1);
  const a = host.children[0];
  assert.equal(a.href, 'https://example.com/x');
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener noreferrer');
  assert.equal(a.getAttribute('aria-label'), 'Open source');
  paintServiceButtons(host, both);
  assert.deepEqual([...host.children].map((c) => c.getAttribute('aria-label')), ['Open on YouTube', 'Open on SoundCloud']);
  paintServiceButtons(host, { ...none, source_url: 'javascript:alert(1)' });
  assert.equal(host.children.length, 0);
});

test('Wikipedia button: song article, else artist article, else none; sits after the service links', () => {
  const host = document.createElement('span');
  const song = { ...both, wikipedia_song: 'https://en.wikipedia.org/wiki/S', wikipedia_artist: 'https://en.wikipedia.org/wiki/B' };
  paintServiceButtons(host, song);
  const labels = () => [...host.children].map((c) => c.getAttribute('aria-label'));
  assert.deepEqual(labels(), ['Open on YouTube', 'Open on SoundCloud', 'Song on Wikipedia']);
  const w = host.children[2];
  assert.equal(w.href, 'https://en.wikipedia.org/wiki/S');
  assert.equal(w.target, '_blank');
  assert.equal(w.rel, 'noopener noreferrer');
  assert.equal(w.title, 'Song on Wikipedia');
  paintServiceButtons(host, { ...song, wikipedia_song: null });
  assert.equal(host.children[2].href, 'https://en.wikipedia.org/wiki/B');
  assert.equal(host.children[2].getAttribute('aria-label'), 'Artist on Wikipedia');
  paintServiceButtons(host, { ...none, source_url: null });
  assert.equal(host.hidden, true);
  assert.equal($('player-links'), null);
});

test('Song info button opens the read-only card, not the edit dialog; guests keep it, Edit stays in the card for writers only', async () => {
  await import('./song-card.js');
  store.songs = [both];
  store.loaded = true;
  player.playNow('a');
  assert.equal($('p-view').hidden, false);
  assert.equal($('p-edit'), null);
  $('p-view').dispatchEvent(makeEvent('click'));
  await flush();
  const card = $('song-card');
  assert.ok(card.querySelector('.card-head'));
  const names = () => card.querySelectorAll('.card-actions button').map((b) => b.getAttribute('aria-label') || b.textContent);
  assert.ok(names().includes('Edit'));
  assert.equal($('edit-dialog').querySelector('form, input'), null);
  card.close?.();
  g.setGuest({ guest: true, audio: true });
  $('p-view').dispatchEvent(makeEvent('click'));
  await flush();
  assert.ok(!names().includes('Edit'));
  assert.equal($('p-view').hidden, false);
  card.close?.();
  g.clearGuest();
});
