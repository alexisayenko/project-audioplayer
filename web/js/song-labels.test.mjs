import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, makeEvent, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const calls = stubFetch((url) => ({ body: url === '/genres/vocabulary' ? { genres: [], aliases: {} } : { songs: [], id: 'x' } }));
const { songForm } = await import('./song-form.js');
const { patchBody } = await import('./song-payload.js');
const { api } = await import('./api.js');
const { store } = await import('./store.js');
const { player, initPlayer } = await import('./player.js');
initPlayer();
const { cardModel, openSongCard } = await import('./song-card.js');

const STORED = { id: 's1', title: 'Song', mainArtists: ['Band'], featuredArtists: [], tags: ['rock'], albums: ['LP'], labels: ['Parvati Records'], file: 'x.mp3' };
const pills = (f) => f.node.querySelector('.label-field .chips').children.map((c) => c.getAttribute('title'));
const typeLabel = (f, text) => {
  const input = f.node.querySelector('.label-field input');
  input.value = text;
  input.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
};

test('the song form has a Labels field showing the stored labels, with no key for none', () => {
  const f = songForm({ mode: 'edit', song: STORED });
  assert.ok(f.node.querySelector('.label-field'));
  assert.equal(f.node.querySelector('.label-field label').textContent, 'Labels');
  assert.deepEqual(pills(f), ['Parvati Records']);
  assert.deepEqual(f.values().labels, ['Parvati Records']);
  assert.deepEqual(songForm({ mode: 'add', song: {} }).values().labels, []);
});

test('typing a label and saving flushes it into the values (Add and Edit share the form)', () => {
  const f = songForm({ mode: 'add', song: {} });
  const input = f.node.querySelector('.label-field input');
  input.value = ' Iono   Music ';
  assert.deepEqual(f.values().labels, ['Iono Music']);
  assert.deepEqual(songForm({ mode: 'add', song: {} }).values({ commit: false }).labels, []);
});

test('a label change tells the form listeners and reset restores the stored labels', () => {
  let fired = 0;
  const f = songForm({ mode: 'edit', song: STORED, onChange: () => { fired += 1; } });
  typeLabel(f, 'Phonokol');
  assert.ok(fired > 0);
  assert.deepEqual(f.values().labels, ['Parvati Records', 'Phonokol']);
  f.reset();
  assert.deepEqual(f.values().labels, ['Parvati Records']);
  assert.deepEqual(pills(f), ['Parvati Records']);
  f.destroy();
});

test('patchBody sends labels only when they changed, and an empty list clears them', () => {
  const same = patchBody({ title: 'S', tags: [], labels: [' Parvati  Records '] }, STORED);
  assert.ok(!('labels' in same));
  assert.deepEqual(patchBody({ title: 'S', tags: [], labels: ['Parvati Records', 'Phonokol'] }, STORED).labels, ['Parvati Records', 'Phonokol']);
  assert.deepEqual(patchBody({ title: 'S', tags: [], labels: [] }, STORED).labels, []);
  assert.ok(!('labels' in patchBody({ title: 'S', tags: [], labels: [] }, { id: 's2' })), 'nothing stored and nothing typed');
  assert.ok(!('labels' in patchBody({ title: 'S', tags: [] }, STORED)), 'a caller without the field leaves them alone');
});

test('addSong sends labels only when there are some', async () => {
  calls.length = 0;
  await api.addSong('u', {}, ['t'], false, null, null, ['Parvati Records']);
  await api.addSong('u', {}, ['t'], false, null, null, []);
  await api.addSong('u', {}, ['t']);
  const bodies = calls.filter((c) => c.url === '/songs').map((c) => JSON.parse(c.opts.body));
  assert.deepEqual(bodies[0].labels, ['Parvati Records']);
  assert.ok(!('labels' in bodies[1]));
  assert.ok(!('labels' in bodies[2]));
});

test('Song Details lists the labels', () => {
  assert.deepEqual(cardModel(STORED).labels, ['Parvati Records']);
  assert.deepEqual(cardModel({ ...STORED, labels: undefined }).labels, []);
  store.songs = [STORED, { id: 's2', title: 'Two', tags: [], labels: ['Blue Room Released', 'Phonokol'], file: null }, { id: 's3', title: 'Three', tags: [], file: null }];
  store.loaded = true;
  const text = (song) => {
    openSongCard(song);
    const out = document.getElementById('song-card').querySelector('.card-details')?.textContent || '';
    document.getElementById('song-card').close?.();
    return out;
  };
  assert.match(text(store.songs[0]), /Label: Parvati Records/);
  assert.match(text(store.songs[1]), /Labels: Blue Room Released, Phonokol/);
  assert.doesNotMatch(text(store.songs[2]), /Label/);
  assert.ok(player);
});
