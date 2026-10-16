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
const names = (dlg) => dlg.querySelectorAll('.card-actions button').map((b) => b.getAttribute('aria-label') || b.textContent);

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

test('playControl: only Play now, none when not playable', () => {
  assert.equal(playControl(FULL, { queueable: true }).label, 'Play now');
  assert.equal(playControl(BARE, { queueable: false }), null);
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
  assert.deepEqual(names(dlg), ['Play now', 'Share link', 'Download', 'Edit', 'Add to playlist']);
  assert.ok(dlg.querySelectorAll('.card-icons button').every((b) => b.getAttribute('aria-label') && b.title), 'icon buttons are labelled');
  assert.equal(dlg.querySelector('.card-bar .card-close').textContent, 'Close');
  assert.equal(dlg.querySelector('.card-actions .btn'), null, 'no text button in the action row');
  assert.ok(dlg.querySelector('.card-icons .key.lit') && dlg.querySelector('.card-icons .icon.round'), 'Play now is a dock key, metadata actions are round');
  assert.equal(dlg.querySelectorAll('.card-icons button').length, 5, 'all actions sit in one row');
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
  const btn = (t) => dlg.querySelectorAll('.card-actions button').find((b) => (b.getAttribute('aria-label') || b.textContent) === t);
  btn('Add to playlist').click();
  assert.equal(player.inQueue('a'), true);
  assert.ok(btn('Remove from playlist'), 'the card repaints after the toggle');
  assert.equal(btn('Add to playlist'), undefined, 'the Add button gives way to the Remove button');
  assert.ok(btn('Remove from playlist').classList.contains('icon'), 'Remove is a round icon button in the same row');
  assert.equal(btn('Remove from playlist').title, 'Remove from playlist');
  assert.equal(dlg.querySelector('.card-actions .btn'), null);
  assert.equal(btn('Play'), undefined, 'no Play/Pause toggle on the card');
  btn('Play now').click();
  assert.equal(player.playing, true);
  assert.ok(btn('Play now'), 'the button stays Play now while the song plays');
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
  assert.deepEqual(names(dlg), ['Share link', 'Download to server', 'Edit']);
  dlg.close();
});

test('card shows a Year fact only for a version with a year, both years when they differ', () => {
  assert.equal(cardModel({ ...FULL, remix_year: 2024 }, { kind: 'none' }).yearFact, '2024 · original 1999');
  assert.equal(cardModel(FULL, { kind: 'none' }).yearFact, '');
  assert.equal(cardModel({ ...FULL, remix_year: null }, { kind: 'none' }).yearFact, '');
  assert.equal(cardModel({ ...FULL, remix_year: 2024 }, { kind: 'none' }).sub, 'Zed · 2024', 'sub line shows the version year');
});

test('with a cover the title and the artist line sit inside the cover box; without one they follow as plain text', () => {
  publish([FULL, BARE]);
  openSongCard(FULL);
  const dlg = $('song-card');
  const art = dlg.querySelector('.card-art');
  assert.ok(art.querySelector('img.card-cover'));
  assert.equal(art.querySelector('.cover-text h2#song-card-title').textContent, 'Alpha (Kav)');
  assert.equal(art.querySelector('.cover-text .card-sub').textContent, 'Zed · 1999');
  assert.equal(dlg.querySelector('.card-album').textContent, 'LP');
  assert.ok(!art.contains(dlg.querySelector('.card-album')));
  dlg.close();
  openSongCard(BARE);
  assert.equal(dlg.querySelector('.card-art'), null);
  assert.equal(dlg.querySelector('.card-head h2').textContent, 'Bare');
  dlg.close();
});

test('the facts column sits beside the cover: decade, country, BPM, time and status', () => {
  publish([FULL]);
  openSongCard(FULL);
  const dlg = $('song-card');
  const top = dlg.querySelector('.card-top');
  assert.ok(top.querySelector('.card-art') && top.querySelector('.card-side'));
  const labels = top.querySelectorAll('.side-row .group-name').map((n) => n.textContent);
  assert.deepEqual(labels, ['Country', 'BPM', 'Time', 'Status']);
  assert.ok(!top.contains(dlg.querySelector('.card-tags')));
  dlg.close();
});
