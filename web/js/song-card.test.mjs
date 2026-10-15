import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
initPlayer();
const { cardModel, cardTags, downloadText, playControl, openSongCard } = await import('./song-card.js');

const FULL = {
  id: 'a', title: 'Alpha', remixer: 'Kav', artist: 'Zed', album: 'LP', year: 1999, bpm: 120.4, duration: 125, file: 'a.mp3', cover: true,
  tags: ['genre:rock', 'decade:90s', 'country:de', 'lang:de', 'chill'],
  source_url: 'https://youtu.be/jNQXAC9IVRw', musicbrainz_url: 'https://musicbrainz.org/recording/1', wikipedia_artist: 'https://en.wikipedia.org/wiki/Zed',
};
const BARE = { id: 'n', title: 'Bare', file: null, audio_state: 'none', tags: [] };
const publish = (songs) => { store.songs = songs; store.loaded = true; store.listeners.forEach((fn) => fn()); };
const $ = (id) => document.getElementById(id);
const names = (dlg) => dlg.querySelectorAll('.card-actions button').map((b) => b.textContent);

test('cardModel builds title, sub line, grouped tags, BPM, duration, links and download state', () => {
  const m = cardModel(FULL, { kind: 'none' });
  assert.equal(m.title, 'Alpha');
  assert.equal(m.remix, 'Kav');
  assert.equal(m.sub, 'Zed · 1999');
  assert.equal(m.album, 'LP');
  assert.deepEqual(m.groups.map((g) => g.name), ['Genre', 'Decade', 'Country', 'Tags']);
  assert.ok(!JSON.stringify(m.groups).includes('lang:'), 'lang tags stay hidden as in Playback');
  assert.equal(m.bpm, '120');
  assert.equal(m.duration, '2:05');
  assert.deepEqual(Object.keys(m.links).sort(), ['musicbrainz', 'wikipedia', 'youtube']);
  assert.equal(m.download, 'Downloaded to the server');
});

test('cardModel copes with missing fields', () => {
  const m = cardModel(BARE, { kind: 'none' });
  assert.deepEqual([m.sub, m.bpm, m.duration, m.groups.length, Object.keys(m.links).length], ['', '', '', 0, 0]);
  assert.equal(m.download, 'Not downloaded');
  assert.equal(cardModel(undefined, undefined).title, '');
  assert.equal(downloadText(BARE, { kind: 'queued' }).length > 0, true);
  assert.deepEqual(cardTags(undefined), []);
});

test('playControl: Play now, Play/Pause for the current song, none when not playable', () => {
  assert.equal(playControl(FULL, { cur: null, playing: false, queueable: true }).label, 'Play now');
  assert.equal(playControl(FULL, { cur: FULL, playing: true, queueable: true }).label, 'Pause');
  assert.equal(playControl(FULL, { cur: FULL, playing: false, queueable: true }).label, 'Play');
  assert.equal(playControl(BARE, { cur: null, playing: false, queueable: false }), null);
});

test('the card opens read-only with links, actions and returns focus to the row on Close', () => {
  publish([FULL, BARE]);
  const list = document.createElement('ul');
  list.className = 'songs';
  const row = document.createElement('li');
  row.className = 'song';
  row.dataset.id = 'a';
  const open = document.createElement('button');
  open.className = 'open';
  row.append(open);
  list.append(row);
  document.body.append(list);
  const before = store.listeners.size;
  openSongCard(FULL, open);
  const dlg = $('song-card');
  assert.equal(dlg.open, true);
  assert.equal(dlg.querySelector('h2').textContent, 'Alpha (Kav)');
  assert.equal(dlg.querySelector('img.card-cover').localName, 'img');
  const hrefs = dlg.querySelectorAll('a.svc').map((a) => a.getAttribute('href'));
  assert.equal(hrefs.length, 3);
  assert.ok(dlg.querySelectorAll('a.svc').every((a) => a.getAttribute('target') === '_blank' && a.getAttribute('rel') === 'noopener'));
  assert.deepEqual(names(dlg), ['Play now', 'Add to playlist', 'Download', 'Edit', 'Close']);
  assert.match(dlg.textContent, /Zed · 1999/);
  assert.equal(dlg.querySelector('.card-album').textContent, 'LP');
  assert.equal(store.listeners.size, before + 1);
  dlg.querySelector('.card-close').click();
  assert.equal(dlg.open, false);
  assert.equal(store.listeners.size, before, 'subscriptions are released');
  assert.ok(document.activeElement === open, 'focus returns to the row title');
  list.remove();
});

test('the card opens when querySelectorAll returns a real NodeList (no indexOf or find), as in browsers', () => {
  publish([FULL, BARE]);
  const list = document.createElement('ul');
  list.className = 'songs';
  const row = document.createElement('li');
  row.className = 'song';
  row.dataset.id = 'a';
  const open = document.createElement('button');
  open.className = 'open';
  row.append(open);
  list.append(row);
  document.body.append(list);
  const dlg = $('song-card');
  const nodeList = (arr) => Object.assign(Object.create(null), arr, { length: arr.length, item: (i) => arr[i], forEach: (f) => arr.forEach(f), [Symbol.iterator]: () => arr[Symbol.iterator]() });
  const origDlg = dlg.querySelectorAll;
  const origDoc = document.querySelectorAll;
  dlg.querySelectorAll = (sel) => nodeList(origDlg.call(dlg, sel));
  document.querySelectorAll = (sel) => nodeList(origDoc.call(document, sel));
  try {
    openSongCard(FULL, open);
    assert.equal(dlg.open, true);
    dlg.querySelectorAll('.card-actions button')[0]?.focus?.();
    publish([FULL, BARE]);
    assert.equal(dlg.open, true);
    dlg.querySelector('.card-close').click();
    assert.equal(dlg.open, false);
    assert.ok(document.activeElement === open);
  } finally {
    dlg.querySelectorAll = origDlg;
    document.querySelectorAll = origDoc;
    list.remove();
  }
});

test('Play now plays the song, the playlist button toggles, Edit hands over to the edit dialog', () => {
  publish([FULL, BARE]);
  while (player.current) player.removeAt(0);
  openSongCard(FULL);
  const dlg = $('song-card');
  const btn = (t) => dlg.querySelectorAll('.card-actions button').find((b) => b.textContent === t);
  btn('Add to playlist').click();
  assert.equal(player.inQueue('a'), true);
  assert.ok(btn('Remove from playlist'), 'the card repaints after the toggle');
  assert.ok(btn('Play'), 'the first queued song becomes current, so the primary button resumes it');
  btn('Play').click();
  assert.equal(player.playing, true);
  assert.ok(btn('Pause'), 'the primary button shows Pause while the song plays');
  btn('Pause').click();
  assert.equal(player.playing, false);
  btn('Edit').click();
  assert.equal($('edit-dialog').open, true);
  assert.equal(dlg.open, true, 'the card stays under the edit dialog');
  $('edit-dialog').close();
  dlg.close();
  while (player.current) player.removeAt(0);
});

test('the card refreshes after an edit and closes when the song is deleted', () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  publish([{ ...FULL, title: 'Alpha 2', album: 'New LP' }]);
  assert.equal(dlg.querySelector('h2').textContent, 'Alpha 2 (Kav)');
  assert.match(dlg.textContent, /New LP/);
  publish([]);
  assert.equal(dlg.open, false);
});

test('a backdrop click closes the card, a click inside does not', () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  dlg.onclick(makeEvent('click', { target: dlg.querySelector('h2') }));
  assert.equal(dlg.open, true);
  dlg.onclick(makeEvent('click', { target: dlg }));
  assert.equal(dlg.open, false);
});

test('songs without audio get Download to server, not Download, and no Play when Auto-download is off', () => {
  publish([BARE]);
  openSongCard(BARE);
  const dlg = $('song-card');
  assert.deepEqual(names(dlg), ['Download to server', 'Edit', 'Close']);
  dlg.close();
});

test('card shows a Remix year line only when present', () => {
  assert.equal(cardModel({ ...FULL, remix_year: 2024 }, { kind: 'none' }).remixYear, 'Remix year 2024');
  assert.equal(cardModel(FULL, { kind: 'none' }).remixYear, '');
  assert.equal(cardModel({ ...FULL, remix_year: null }, { kind: 'none' }).remixYear, '');
  assert.equal(cardModel({ ...FULL, remix_year: 2024 }, { kind: 'none' }).sub, 'Zed · 1999', 'sub line keeps the original year');
});
