import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
globalThis.open = () => {};
stubFetch(() => ({ body: { songs: [] } }));
const g = await import('./guest.js');
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
const { songRow } = await import('./library-rows.js');
const { openSongCard } = await import('./song-card.js');
const { renderSettings } = await import('./settings.js');
const { autoDownloadOn, setAutoDownload } = await import('./autodl.js');
const { editDialog } = await import('./edit-dialog.js');
const { openAdd } = await import('./add.js');
const { hasAudio } = await import('./playable.js');
const { coverModel } = await import('./row-cover.js');

const WITH = { id: 'a', title: 'Alpha', artist: 'AA', file: 'a.m4a', audio_state: 'server', tags: [], duration: 100 };
const WITHOUT = { id: 'n', title: 'Nada', artist: 'NN', file: null, audio_state: 'none', tags: [], sources: [{ source: 'youtube', id: 'n', url: 'https://youtu.be/nnnnnnnnnnn' }] };
const $ = (id) => document.getElementById(id);
const labels = (node) => node.querySelectorAll('button').map((b) => b.getAttribute('aria-label') || b.textContent);
const publish = (songs) => { store.songs = songs; store.loaded = true; store.listeners.forEach((fn) => fn()); };

initPlayer();
publish([WITH, WITHOUT]);

function menuItems(row) {
  row.querySelector('.more').click();
  const items = document.querySelectorAll('[role=menuitem]').map((n) => n.textContent);
  document.querySelectorAll('[role=menu]').forEach((n) => n.remove());
  return items;
}

test('signed in: rows show the edit and download-to-server controls', () => {
  g.clearGuest();
  const row = songRow(WITHOUT, null, null);
  assert.ok(row.querySelector('.row-dl'), 'download to server button');
  assert.ok(menuItems(row).includes('Edit song'));
});

test('guest: rows have no edit, no download-to-server, and the cover opens the source', () => {
  g.setGuest({ guest: true, audio: true });
  const row = songRow(WITHOUT, null, null);
  assert.equal(row.querySelector('.row-dl'), null);
  assert.ok(row.querySelector('.src-logo'));
  assert.ok(row.querySelector('.row-cover.act-source'));
  const items = menuItems(row);
  assert.ok(!items.includes('Edit song'));
  assert.ok(!items.some((l) => /Download/.test(l)));
  const withAudio = menuItems(songRow(WITH, null, null));
  assert.ok(!withAudio.includes('Edit song') && !withAudio.includes('Download'));
  assert.ok(withAudio.includes('Play now'));
  g.clearGuest();
});

test('guest: song card has no Edit or Download buttons but keeps Play and Close', () => {
  g.setGuest({ guest: true, audio: true });
  openSongCard(WITH, null);
  const names = labels($('song-card'));
  assert.ok(!names.includes('Edit') && !names.includes('Download'));
  assert.ok(names.includes('Play now') && names.includes('Close'));
  $('song-card').close?.();
  g.clearGuest();
  openSongCard(WITH, null);
  assert.ok(labels($('song-card')).includes('Edit'));
  assert.ok(labels($('song-card')).includes('Download'));
  $('song-card').close?.();
});

test('guest without audio: the card offers the source link and rows cannot be queued', () => {
  g.setGuest({ guest: true, audio: false });
  assert.equal(hasAudio(WITH), false);
  openSongCard(WITHOUT, null);
  assert.ok(labels($('song-card')).includes('Open on YouTube'));
  $('song-card').close?.();
  const row = songRow(WITH, null, null);
  assert.ok(row.querySelector('.pl-toggle.ph'));
  g.clearGuest();
});

test('guest: player edit and download controls are hidden, the mini-player has no edit button; the Song info button stays', () => {
  g.setGuest({ guest: true, audio: true });
  player.playNow('a');
  assert.equal($('p-view').hidden, false);
  assert.equal($('p-edit'), null);
  assert.equal($('mini-edit'), null);
  assert.equal($('p-download').hidden, true);
  assert.equal($('p-play').hidden, false);
  g.clearGuest();
  player.toggle();
  player.toggle();
  assert.equal($('p-view').hidden, false);
  assert.equal($('mini-edit'), null);
  assert.equal($('p-download').hidden, false);
});

test('guest: edit and add entry points do nothing, auto-download is forced off', () => {
  g.setGuest({ guest: true, audio: true });
  editDialog(WITH);
  openAdd();
  assert.equal($('edit-dialog').childNodes.length, 0);
  assert.equal($('add-dialog').childNodes.length, 0);
  setAutoDownload(true);
  assert.equal(autoDownloadOn(), false);
  g.clearGuest();
  assert.equal(autoDownloadOn(), true);
  setAutoDownload(false);
});

test('coverModel: guests get an open-source action only when there is a link', () => {
  g.setGuest({ guest: true, audio: true });
  assert.equal(coverModel({ audio: false, queueable: false, here: false, source: true }).action, 'source');
  assert.equal(coverModel({ audio: false, queueable: false, here: false, source: false }).action, 'none');
  g.clearGuest();
  assert.equal(coverModel({ audio: false, queueable: false, here: false, source: true }).action, 'download');
});

test('guest settings show only the sign-in section and the viewing note', async () => {
  g.setGuest({ guest: true, audio: true, owner_label: 'Alex' });
  stubFetch((url) => (url === '/auth/config' ? { body: {} } : { status: 401, body: {} }));
  const root = document.createElement('div');
  document.body.append(root);
  renderSettings(root);
  await flush();
  assert.match(root.textContent, /You are viewing Alex's library \(read-only\)/);
  assert.match(root.textContent, /Account/);
  assert.doesNotMatch(root.textContent, /Auto-download/);
  assert.doesNotMatch(root.textContent, /Library on the server/);
  g.clearGuest();
});

test('mini-player: no edit button; the target button opens the song card of the playing song', async () => {
  g.clearGuest();
  player.playNow('a');
  assert.equal($('mini-edit'), null);
  $('song-card').close?.();
  $('mini-locate').click();
  await flush();
  assert.ok($('song-card').open || $('song-card').childNodes.length > 0);
  $('song-card').close?.();
});
