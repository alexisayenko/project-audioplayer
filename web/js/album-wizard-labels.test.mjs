import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => {
  const t = realSetTimeout(fn, ms, ...a);
  if (ms > 5000) t.unref?.();
  return t;
};
const { initPlayer } = await import('./player.js');
initPlayer();
const { resetVocabulary, buildIndex } = await import('./genre-vocab.js');
resetVocabulary(buildIndex({ genres: ['Techno', 'psytrance', 'goa trance'].map((name) => ({ name, family: 'Electronic', level: 'genre' })), aliases: {} }));
const { openAddAlbum } = await import('./album-wizard.js');
const { VIDEO: PV, DISC } = await import('./album-wizard-fixture.mjs');
const { openAlbumEdit, openAlbumCard, albumHead } = await import('./albums.js');
const { store } = await import('./store.js');

const VIDEO = 'https://youtu.be/yeUFSnA9Puk?si=abc';
const LIST = 'https://www.youtube.com/playlist?list=PLabcdefghij';
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await flush(); };
const post = (calls, url) => JSON.parse(calls.find((c) => c.url === url).opts.body);
const nextBtn = () => q('.wiz-next');
const type = (node, value) => { node.value = value; fire(node, 'input'); };
const go = async () => { fire(q('.wiz-fetch') || nextBtn(), 'click'); await settle(); };
const labelPills = () => qa('.wiz-labels .chips .chip').map((c) => c.getAttribute('title'));
const labelInput = () => q('.wiz-labels input');
const addLabel = (text) => { const i = labelInput(); i.value = text; fire(i, 'keydown', { key: 'Enter' }); };

const MASTER = { kind: 'master', id: 7, url: 'https://www.discogs.com/master/7', title: 'Twisted', artist: 'Hallucinogen', year: 1995, cover: 'https://img.discogs.com/c.jpg', genres: ['Electronic'], styles: ['Psy-Trance'], trackCount: 4, type: null, label: null, labels: [] };
const RESOLVED = { ...MASTER, type: 'album', tracks: DISC.tracks, label: 'Dragonfly Records', labels: ['Dragonfly Records', 'Phonokol'] };
const PL = {
  playlist: { title: 'Twisted', uploader: 'Topic', count: 3, url: LIST },
  tracks: [
    { position: 1, videoId: 'aaaaaaaaaaa', title: 'LSD', durationS: 300, url: 'https://youtu.be/aaaaaaaaaaa', songId: null, artists: ['Hallucinogen'], version: null },
    { position: 2, videoId: 'bbbbbbbbbbb', title: 'Gloople', durationS: 500, url: 'https://youtu.be/bbbbbbbbbbb', songId: 's1', artists: ['Hallucinogen'], version: null },
    { position: 3, videoId: 'ccccccccccc', title: 'Spirit Guide', durationS: 400, url: 'https://youtu.be/ccccccccccc', songId: null, artists: ['Hallucinogen'], version: null },
  ],
  album: { title: 'Twisted', albumArtist: 'Hallucinogen', type: 'album', year: 1995, coverUrl: null },
  guess: {}, genres: [], links: {}, thumbnail: 'https://i.ytimg.com/p.jpg',
};

function server(o = {}) {
  return stubFetch((u, opts) => {
    if (u === '/albums/from-video/preview') return ok(PV);
    if (u === '/albums/youtube/preview') return ok(PL);
    if (u === '/albums/discogs/search') return ok({ candidates: [MASTER], searchError: null });
    if (u === '/albums/discogs/resolve') return ok({ candidate: o.resolved || RESOLVED, searchError: null });
    if (u === '/albums/genres/suggest') return ok({ suggestions: [], wikipediaPage: null, searchError: null });
    if (u === '/albums/from-video') return ok({ jobId: 'j1', albumId: 'alb_1', songIds: ['n1', 'n3'] }, 202);
    if (u === '/albums/youtube/commit') return ok({ album: { id: 'alb_2' }, songs: [], linked: 3, unlinked: 0 }, 201);
    if (u === '/jobs/j1') return ok({ state: 'done', done: 2, total: 2, current: 'LSD' });
    if (u === '/me') return ok({ owner: false });
    if (u === '/albums') return ok([]);
    if (u === '/library') return ok({ songs: [] });
    return ok({});
  });
}

async function toReview(address = VIDEO) {
  openAddAlbum();
  type(q('#wiz-url'), address);
  await go();
  await go();
  await settle();
}

test('the Review step has a Labels field prefilled from the Discogs pick', async () => {
  server();
  await toReview();
  assert.ok(q('.wiz-labels'));
  assert.equal(q('.wiz-labels h3').textContent, 'Labels');
  assert.deepEqual(labelPills(), ['Dragonfly Records', 'Phonokol']);
  D().close();
});

test('a pick with no label leaves the field empty, ready for free entry', async () => {
  server({ resolved: { ...RESOLVED, label: null, labels: [] } });
  await toReview();
  assert.deepEqual(labelPills(), []);
  addLabel('Parvati Records');
  assert.deepEqual(labelPills(), ['Parvati Records']);
  D().close();
});

test('a video create sends the edited labels with the album', async () => {
  const calls = server();
  await toReview();
  qa('.wiz-labels .chips .x')[1].click();
  addLabel('Iono Music');
  assert.deepEqual(labelPills(), ['Dragonfly Records', 'Iono Music']);
  fire(nextBtn(), 'click');
  await settle();
  assert.deepEqual(post(calls, '/albums/from-video').album.labels, ['Dragonfly Records', 'Iono Music']);
});

test('a playlist commit sends the labels too, and a half-typed label is not lost', async () => {
  const calls = server();
  await toReview(LIST);
  const input = labelInput();
  input.value = 'Typed Label';
  fire(nextBtn(), 'click');
  await settle();
  assert.deepEqual(post(calls, '/albums/youtube/commit').album.labels, ['Dragonfly Records', 'Phonokol', 'Typed Label']);
});

test('clearing every label sends none, and the old payload shape stays when there never were any', async () => {
  const calls = server({ resolved: { ...RESOLVED, labels: [] } });
  await toReview();
  fire(nextBtn(), 'click');
  await settle();
  assert.equal('labels' in post(calls, '/albums/from-video').album, false);
});

test('picking another Discogs album refills the labels unless the user edited them', async () => {
  const { newDraft, applyPreview, albumNow } = await import('./album-wizard-model.js');
  const { setPick, resolvePick } = await import('./album-wizard-flow.js');
  const draft = applyPreview(newDraft(), 'video', VIDEO, PV);
  await resolvePick(draft, MASTER, { resolve: async () => ({ candidate: RESOLVED }) });
  assert.deepEqual(draft.album.labels, ['Dragonfly Records', 'Phonokol']);
  assert.deepEqual(albumNow(draft).labels, ['Dragonfly Records', 'Phonokol']);
  const other = { ...MASTER, id: 8 };
  await resolvePick(draft, other, { resolve: async () => ({ candidate: { ...RESOLVED, labels: ['Other Label'] } }) });
  assert.deepEqual(draft.album.labels, ['Other Label']);
  setPick(draft, 'none');
  assert.deepEqual(draft.album.labels, [], 'None of these drops the Discogs labels');
  draft.touched.labels = true;
  draft.album.labels = ['Mine'];
  await resolvePick(draft, MASTER, { resolve: async () => ({ candidate: RESOLVED }) });
  assert.deepEqual(draft.album.labels, ['Mine']);
});

test('the album Edit dialog has a Labels field and sends only a changed list', async () => {
  const dlg = document.getElementById('edit-dialog');
  const album = { id: 'alb_9', title: 'Twisted', artist: 'Hallucinogen', year: 1995, genres: [], labels: ['Dragonfly Records'], links: {}, tracks: [] };
  const calls = stubFetch((u, o) => (o.method === 'PATCH' ? ok({ ...album, labels: ['Dragonfly Records', 'Phonokol'] }) : ok({})));
  let saved = null;
  openAlbumEdit(album, (full) => { saved = full; });
  const field = dlg.querySelector('.label-field');
  assert.ok(field);
  assert.deepEqual([...field.querySelectorAll('.chips .chip')].map((c) => c.getAttribute('title')), ['Dragonfly Records']);
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(calls.some((c) => c.opts.method === 'PATCH'), false, 'unchanged labels make no request');

  openAlbumEdit(album, (full) => { saved = full; });
  const input = dlg.querySelector('.label-field input');
  input.value = 'Phonokol';
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  const patch = calls.find((c) => c.opts.method === 'PATCH');
  assert.equal(patch.url, '/albums/alb_9');
  assert.deepEqual(JSON.parse(patch.opts.body), { labels: ['Dragonfly Records', 'Phonokol'] });
  assert.deepEqual(saved.labels, ['Dragonfly Records', 'Phonokol']);
});

test('clearing the labels of an album sends an empty list; a 422 on labels is said under the field', async () => {
  const dlg = document.getElementById('edit-dialog');
  const album = { id: 'alb_9', title: 'Twisted', artist: 'Hallucinogen', year: 1995, genres: [], labels: ['Dragonfly Records'], links: {}, tracks: [] };
  let calls = stubFetch((u, o) => (o.method === 'PATCH' ? ok({ ...album, labels: [] }) : ok({})));
  openAlbumEdit(album, () => {});
  dlg.querySelector('.label-field .x').click();
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  assert.deepEqual(JSON.parse(calls.find((c) => c.opts.method === 'PATCH').opts.body), { labels: [] });

  calls = stubFetch((u, o) => (o.method === 'PATCH' ? { status: 422, body: { detail: { code: 'bad_field', key: 'labels' } } } : ok({})));
  openAlbumEdit(album, () => {});
  dlg.querySelector('.label-field .x').click();
  fire(dlg.querySelector('form'), 'submit');
  for (let i = 0; i < 5; i++) await flush();
  const err = dlg.querySelector('.label-field .msg.error');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /labels/i);
  dlg.close();
});

test('the album info box and the album head show the labels', () => {
  store.songs = [];
  const album = { id: 'alb_9', title: 'Twisted', artist: 'Hallucinogen', year: 1995, genres: [], labels: ['Blue Room Released', 'Phonokol'], links: {}, tracks: [{ no: 1, title: 'LSD', durationS: 300, songId: null }] };
  openAlbumCard(album);
  const dlg = document.getElementById('song-card');
  assert.equal(dlg.querySelector('.album-labels').textContent, 'Labels: Blue Room Released, Phonokol');
  dlg.close();
  openAlbumCard({ ...album, labels: ['Phonokol'] });
  assert.equal(dlg.querySelector('.album-labels').textContent, 'Label: Phonokol');
  dlg.close();
  openAlbumCard({ ...album, labels: [] });
  assert.equal(dlg.querySelector('.album-labels'), null);
  dlg.close();
  assert.equal(albumHead(album).querySelector('.album-labels').textContent, 'Labels: Blue Room Released, Phonokol');
  assert.equal(albumHead({ ...album, labels: undefined }).querySelector('.album-labels'), null);
});
