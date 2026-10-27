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
resetVocabulary(buildIndex({ genres: ['Techno', 'Ambient', 'Dub', 'House', 'psytrance', 'goa trance'].map((name) => ({ name, family: 'Electronic', level: 'genre' })), aliases: {} }));
const { openAddAlbum } = await import('./album-wizard.js');
const { VIDEO: PV, DISC } = await import('./album-wizard-fixture.mjs');

const VIDEO = 'https://youtu.be/yeUFSnA9Puk?si=abc';
const LIST = 'https://www.youtube.com/playlist?list=PLabcdefghij';
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
async function until(cond, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
  return cond();
}
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await flush(); };
const post = (calls, url) => JSON.parse(calls.find((c) => c.url === url).opts.body);
const count = (calls, url) => calls.filter((c) => c.url === url).length;
const nextBtn = () => q('.wiz-next');
const backBtn = () => q('.wiz-back');
const type = (node, value) => { node.value = value; fire(node, 'input'); };
const go = async () => { fire(q('.wiz-fetch') || nextBtn(), 'click'); await settle(); };
const tokenFields = () => qa('.wiz-details .token-field');
const pills = (node) => [...node.querySelectorAll('.token-text')].map((p) => p.textContent);
const setToken = (node, value) => { node.value = value; fire(node, 'input'); };
const yearIn = () => q('.wiz-details .album-year');
const stepText = () => q('.wiz-stepline').textContent;
const rows = () => qa('li.wiz-row');
const selectedValue = (row) => [...row.querySelectorAll('option')].find((o) => o.selected || o.getAttribute('selected') !== null)?.value;

const MASTER = { kind: 'master', id: 7, url: 'https://www.discogs.com/master/7', title: 'Twisted', artist: 'Hallucinogen', year: 1995, cover: 'https://img.discogs.com/c.jpg', genres: ['Electronic'], styles: ['Psy-Trance'], trackCount: 4, type: null };
const RESOLVED = { ...MASTER, type: 'album', tracks: DISC.tracks };
const SUGGEST = { suggestions: [
  { name: 'Psy-Trance', source: 'discogs', mapped: 'psytrance', unmapped: false },
  { name: 'Weird Thing', source: 'discogs', mapped: null, unmapped: true },
  { name: 'Goa', source: 'wikipedia', mapped: 'goa trance', unmapped: false },
], wikipediaPage: 'https://en.wikipedia.org/wiki/Twisted_(Hallucinogen_album)', searchError: null };

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
  let polls = 0;
  return stubFetch((u, opts) => {
    if (u === '/albums/from-video/preview') return (o.preview || (() => ok(PV)))(opts);
    if (u === '/albums/from-video/preview-text') return (o.previewText || (() => ok({ ...PV, source: 'pasted' })))(opts);
    if (u === '/albums/youtube/preview') return (o.playlist || (() => ok(PL)))(opts);
    if (u === '/albums/discogs/search') return (o.find || (() => ok({ candidates: [MASTER], searchError: null })))(opts);
    if (u === '/albums/discogs/resolve') return (o.resolve || (() => ok({ candidate: RESOLVED, searchError: null })))(opts);
    if (u === '/albums/genres/suggest') return (o.suggest || (() => ok(SUGGEST)))(opts);
    if (u === '/albums/from-video') return (o.create || (() => ok({ jobId: 'j1', albumId: 'alb_1', songIds: ['n1', 'n3'] }, 202)))(opts);
    if (u === '/albums/youtube/commit') return (o.commit || (() => ok({ album: { id: 'alb_2' }, songs: [], linked: 3, unlinked: 0 }, 201)))(opts);
    if (u === '/jobs/j1') {
      polls += 1;
      return o.job ? o.job(polls) : ok({ state: polls < 2 ? 'splitting' : 'done', done: polls < 2 ? 1 : 2, total: 2, current: 'LSD' });
    }
    if (u === '/me') return ok({ owner: false });
    if (u === '/albums') return ok([]);
    if (u === '/library') return ok({ songs: [] });
    return ok({});
  });
}

async function fetchStep(address = VIDEO) {
  openAddAlbum();
  type(q('#wiz-url'), address);
  await go();
}

test('step 1 takes one address; the placeholder names the two kinds and the Discogs link mode is gone', async () => {
  server();
  openAddAlbum();
  assert.equal(q('#wiz-url').placeholder, 'YouTube playlist or video address');
  assert.match(stepText(), /^Step 1 of 5 · Link$/);
  assert.equal(backBtn().hidden, true);
  assert.equal(nextBtn().hidden, true);
  const btn = q('.wiz-well .wiz-fetch');
  assert.equal(btn.textContent, 'Fetch');
  assert.equal(btn.parentNode, q('#wiz-url').parentNode);
  assert.equal(btn.disabled, true);
  type(q('#wiz-url'), VIDEO);
  assert.equal(btn.disabled, false);
  D().close();
});

test('the Fetch button is disabled while the address is read and comes back after', async () => {
  let release;
  server({ preview: () => new Promise((r) => { release = () => r(ok(PV)); }) });
  openAddAlbum();
  type(q('#wiz-url'), VIDEO);
  fire(q('.wiz-fetch'), 'click');
  await settle();
  assert.equal(q('.wiz-fetch').disabled, true);
  assert.equal(q('.wiz-fetch').getAttribute('aria-busy'), '');
  release();
  await settle();
  assert.match(stepText(), /Details/);
  D().close();
});

test('other links get a clear error and no request; a Discogs link gets one extra line', async () => {
  const calls = server();
  openAddAlbum();
  type(q('#wiz-url'), 'https://www.discogs.com/release/545650-Derango-Tumult');
  await go();
  assert.match(q('.wiz-msg').textContent, /takes a YouTube playlist or a video with time codes/);
  assert.match(q('.wiz-msg').textContent, /Discogs fills the details after you add the YouTube link/);
  type(q('#wiz-url'), '');
  await go();
  assert.match(q('.wiz-msg').textContent, /Paste a YouTube playlist or video address/);
  assert.equal(calls.length, 0);
  D().close();
});

test('Fetch reads the video and step 2 suggests artist, album and year without listing the tracks', async () => {
  const calls = server();
  await fetchStep();
  assert.deepEqual(post(calls, '/albums/from-video/preview'), { url: VIDEO, allowEmpty: true });
  assert.match(stepText(), /^Step 2 of 5 · Details$/);
  assert.deepEqual(tokenFields().map(pills), [['Hallucinogen'], ['Twisted']]);
  assert.equal(yearIn().value, '1995');
  assert.equal(qa('li').filter((li) => /LSD/.test(li.textContent)).length, 0);
  assert.equal(q('.wiz-source').textContent, 'Topic · Hallucinogen - Twisted (1995) [FULL ALBUM] · 3 tracks · 20:00');
  const link = q('.wiz-source a');
  assert.equal(link.getAttribute('href'), 'https://youtu.be/yeUFSnA9Puk');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
  D().close();
});

test('artist and album name are token pills: dashes split, the payload keeps one text and Discogs gets the joined artists', async () => {
  const calls = server();
  await fetchStep();
  const [artist, album] = tokenFields();
  setToken(artist, 'Hallucinogen - Simon Posford - Raja Ram');
  setToken(album, 'Twisted - Remastered');
  assert.deepEqual(pills(artist), ['Hallucinogen', 'Simon Posford', 'Raja Ram']);
  assert.deepEqual(pills(album), ['Twisted', 'Remastered']);
  await go();
  assert.deepEqual(post(calls, '/albums/discogs/search'), { artist: 'Hallucinogen & Simon Posford & Raja Ram', title: 'Twisted - Remastered', year: 1995 });
  D().close();
});

test('removing an artist pill with its x updates the draft; an emptied artist stops step 2', async () => {
  const calls = server();
  await fetchStep();
  const [artist] = tokenFields();
  setToken(artist, 'Hallucinogen - Simon Posford');
  const remove = (name) => fire([...artist.querySelectorAll('.token-btn')].find((b) => b.getAttribute('aria-label') === `Remove ${name}`), 'click');
  remove('Simon Posford');
  assert.deepEqual(pills(artist), ['Hallucinogen']);
  remove('Hallucinogen');
  await go();
  assert.match(q('.wiz-msg').textContent, /Give the album an artist/);
  assert.equal(count(calls, '/albums/discogs/search'), 0);
  D().close();
});

test('a channel name used as the artist is flagged for a check; a Topic channel is not', async () => {
  server({ preview: () => ok({ ...PV, uploader: 'Panayotis Kritidis', title: 'Total Eclipse Delta Aquarids', album: { ...PV.album, albumArtist: 'Panayotis Kritidis', title: 'Total Eclipse Delta Aquarids' } }) });
  await fetchStep();
  assert.match(q('.wiz-details').textContent, /The artist is the channel name/);
  assert.match(q('.wiz-source').textContent, /^Panayotis Kritidis · Total Eclipse Delta Aquarids · 3 tracks · 20:00$/);
  D().close();
  server();
  await fetchStep();
  assert.doesNotMatch(q('.wiz-details').textContent, /channel name/);
  D().close();
});

test('Enter in the address field fetches', async () => {
  const calls = server();
  openAddAlbum();
  type(q('#wiz-url'), VIDEO);
  fire(q('#wiz-url'), 'keydown', { key: 'Enter' });
  await settle();
  assert.equal(count(calls, '/albums/from-video/preview'), 1);
  D().close();
});

test('one confident Discogs master skips step 3 and lands on the review with the matched pairs', async () => {
  const calls = server();
  await fetchStep();
  await go();
  assert.deepEqual(post(calls, '/albums/discogs/search'), { artist: 'Hallucinogen', title: 'Twisted', year: 1995 });
  assert.deepEqual(post(calls, '/albums/discogs/resolve'), { kind: 'master', id: 7 });
  assert.match(stepText(), /^Step 4 of 5 · Review$/);
  assert.equal(rows().length, 4);
  assert.match(rows()[0].textContent, /1\.\s*LSD/);
  assert.match(rows()[1].textContent, /Snakey Shaker/);
  assert.equal(rows()[1].querySelector('input[type=checkbox]').checked, false);
  assert.ok(selectedValue(rows()[0]) !== '');
  assert.equal(selectedValue(rows()[1]), '');
  assert.equal(q('.wiz-dots li[data-step="discogs"]').className.includes('skipped'), true);
  D().close();
});

test('Back from the review steps over the skipped Discogs step and keeps the typed values', async () => {
  const calls = server();
  await fetchStep();
  setToken(tokenFields()[0], 'Hallucinogen');
  await go();
  fire(backBtn(), 'click');
  await settle();
  assert.match(stepText(), /^Step 2 of 5 · Details$/);
  fire(backBtn(), 'click');
  await settle();
  assert.equal(q('#wiz-url').value, VIDEO);
  await go();
  assert.equal(count(calls, '/albums/from-video/preview'), 1);
  assert.match(stepText(), /Details/);
  await go();
  assert.equal(count(calls, '/albums/discogs/search'), 1);
  D().close();
});

test('with no confident match step 3 lists one row per album, None of these, and Show all releases', async () => {
  const calls = server({ find: (o) => ok({ candidates: JSON.parse(o.body).all ? [MASTER, { ...MASTER, kind: 'release', id: 99, trackCount: 4 }] : [MASTER, { ...MASTER, id: 8, year: 1996 }], searchError: null }) });
  await fetchStep();
  await go();
  assert.match(stepText(), /^Step 3 of 5 · Discogs$/);
  assert.equal(qa('.wiz-cand').length, 3);
  assert.match(q('.wiz-none').textContent, /None of these/);
  fire(q('.discogs-all'), 'click');
  await settle();
  assert.equal(JSON.parse(calls.filter((c) => c.url === '/albums/discogs/search').at(-1).opts.body).all, true);
  assert.equal(qa('.wiz-cand').length, 3);
  await go();
  assert.match(q('.wiz-msg').textContent, /Pick an album, or choose None of these/);
  D().close();
});

test('None of these goes on with the YouTube tracks alone', async () => {
  const calls = server({ find: () => ok({ candidates: [], searchError: null }) });
  await fetchStep();
  await go();
  assert.match(q('.wiz-pick').textContent, /No match on Discogs/);
  await go();
  assert.match(stepText(), /Review/);
  assert.equal(count(calls, '/albums/discogs/resolve'), 0);
  assert.equal(rows().length, 3);
  assert.equal(rows()[1].querySelector('input[type=checkbox]').checked, false);
  D().close();
});

test('Discogs not set up or failing is said in step 3 and does not block', async () => {
  server({ find: () => ok({ candidates: [], searchError: 'discogs_unavailable' }) });
  await fetchStep();
  await go();
  assert.match(q('.wiz-pick').textContent, /not set up on this server/);
  D().close();
  server({ find: () => ({ status: 500, body: {} }) });
  await fetchStep();
  await go();
  assert.match(q('.wiz-pick').textContent, /Discogs could not be reached|No match on Discogs/);
  D().close();
});

test('a failed resolve keeps step 3 with a message', async () => {
  server({ find: () => ok({ candidates: [MASTER, { ...MASTER, id: 8, year: 1996 }], searchError: null }), resolve: () => ok({ candidate: null, searchError: 'discogs_failed' }) });
  await fetchStep();
  await go();
  q('.wiz-cand input').checked = true;
  fire(q('.wiz-cand input'), 'change');
  await go();
  assert.match(q('.wiz-msg').textContent, /could not be read/);
  assert.match(stepText(), /Discogs/);
  D().close();
});

test('the review offers the art, genres with their sources, and flags names outside the tree', async () => {
  server();
  await fetchStep();
  await go();
  assert.equal(qa('.wiz-art-opt').length, 2);
  assert.equal(qa('.wiz-art-opt input')[0].checked, true);
  assert.match(qa('.wiz-art-opt')[0].textContent, /Discogs/);
  assert.match(qa('.wiz-art-opt')[1].textContent, /YouTube/);
  await settle();
  const sugs = qa('.wiz-sug');
  assert.equal(sugs.length, 3);
  assert.match(sugs[0].title, /Discogs/);
  assert.match(sugs[1].title, /not in the genre tree/);
  assert.equal(sugs[1].getAttribute('aria-disabled'), 'true');
  assert.match(sugs[2].title, /Wikipedia/);
  fire(sugs[2], 'click');
  await settle();
  assert.equal(qa('.wiz-sug')[2].getAttribute('aria-pressed'), 'true');
  D().close();
});

test('a pasted Rate Your Music link is stored as the album link; pasted genres become pills', async () => {
  const calls = server({ suggest: (o) => ok(JSON.parse(o.body).rym ? { suggestions: [{ name: 'goa', source: 'rym', mapped: 'goa trance', unmapped: false }, { name: 'zzz', source: 'rym', mapped: null, unmapped: true }], wikipediaPage: null, searchError: null } : SUGGEST) });
  await fetchStep();
  await go();
  await settle();
  const rym = q('.wiz-rym input');
  type(rym, 'https://rateyourmusic.com/release/album/hallucinogen/twisted/');
  fire(q('.wiz-rym button'), 'click');
  await settle();
  assert.match(q('.wiz-links').textContent, /Rate Your Music/);
  type(rym, 'goa, zzz');
  fire(q('.wiz-rym button'), 'click');
  await settle();
  assert.equal(JSON.parse(calls.filter((c) => c.url === '/albums/genres/suggest').at(-1).opts.body).rym, 'goa, zzz');
  assert.match(q('.wiz-rym-note').textContent, /1 genre added, 1 not in the genre tree/);
  fire(nextBtn(), 'click');
  await settle();
  const body = post(calls, '/albums/from-video');
  assert.equal(body.album.links.rateyourmusic, 'https://rateyourmusic.com/release/album/hallucinogen/twisted/');
  assert.ok(body.album.genres.includes('goa trance'));
  D().close();
});

test('Download, cut and import posts the album, art, genres and Discogs numbers, then shows the split progress and opens the album', async () => {
  const calls = server();
  globalThis.location.hash = '';
  await fetchStep();
  await go();
  await settle();
  assert.equal(nextBtn().textContent, 'Download, cut and import');
  fire(nextBtn(), 'click');
  await settle();
  const body = post(calls, '/albums/from-video');
  assert.equal(body.coverToSongs, true);
  assert.equal(body.album.coverUrl, 'https://img.discogs.com/c.jpg');
  assert.deepEqual(body.album.genres, ['psytrance']);
  assert.equal(body.album.links.discogs, 'https://www.discogs.com/master/7');
  assert.equal(body.album.title, 'Twisted');
  assert.equal(body.album.albumArtist, 'Hallucinogen');
  assert.deepEqual(body.tracks.filter((t) => t.include).map((t) => [t.title, t.trackNo]), [['LSD', 1], ['Gloople', 3]]);
  assert.match(stepText(), /Step 5 of 5/);
  assert.ok(q('.av-progress'));
  assert.equal(nextBtn().hidden, true);
  assert.ok(await until(() => D().open === false, 5000));
  assert.equal(globalThis.location.hash, '#/library/albums/alb_1');
  assert.match(document.getElementById('toast').textContent, /Added "Twisted"/);
});

test('Close during the split stops polling and leaves the job to the server', async () => {
  const calls = server({ job: () => ok({ state: 'splitting', done: 0, total: 2, current: 'LSD' }) });
  await fetchStep();
  await go();
  await settle();
  fire(nextBtn(), 'click');
  await settle();
  assert.match(q('.wiz-run').textContent, /You can close this/);
  fire(qa('button').find((b) => b.textContent === 'Close'), 'click');
  await settle();
  const polls = count(calls, '/jobs/j1');
  await sleep(40);
  assert.equal(count(calls, '/jobs/j1'), polls);
  assert.equal(D().open, false);
});

test('a failed create stays on the review with the message; the draft is kept', async () => {
  server({ create: () => ({ status: 429, body: { detail: 'rate' } }) });
  await fetchStep();
  await go();
  await settle();
  fire(nextBtn(), 'click');
  await settle();
  assert.match(q('.wiz-msg').textContent, /Hourly limit reached/);
  assert.match(stepText(), /Review/);
  assert.equal(nextBtn().disabled, false);
  D().close();
});

test('409 already exists offers Open it', async () => {
  server({ create: () => ({ status: 409, body: { detail: { code: 'already_exists', id: 'alb_9' } } }) });
  await fetchStep();
  await go();
  await settle();
  fire(nextBtn(), 'click');
  await settle();
  assert.match(q('.wiz-msg').textContent, /already exists/);
  fire(qa('.wiz-msg button')[0], 'click');
  assert.equal(globalThis.location.hash, '#/library/albums/alb_9');
});

test('re-assigning a Discogs track to another video track and skipping one change the body', async () => {
  const calls = server();
  await fetchStep();
  await go();
  await settle();
  const first = rows()[0].querySelector('select');
  first.value = '';
  fire(first, 'change');
  await settle();
  assert.equal(rows()[0].querySelector('input[type=checkbox]').disabled, true);
  assert.match(qa('.wiz-extras-head')[0].textContent, /Other tracks/);
  fire(nextBtn(), 'click');
  await settle();
  const included = post(calls, '/albums/from-video').tracks.filter((t) => t.include);
  assert.deepEqual(included.map((t) => t.title), ['Gloople']);
});

test('a problem blocks the button and is said in the problems line', async () => {
  server();
  await fetchStep();
  await go();
  await settle();
  for (const r of rows()) {
    const box = r.querySelector('input[type=checkbox]');
    if (box.checked) { box.checked = false; fire(box, 'change'); }
  }
  assert.equal(nextBtn().disabled, true);
  assert.match(q('.av-problems').textContent, /Tick at least one track/);
  D().close();
});

const NO_CODES = { ...PV, source: 'none', tracks: [], warnings: [] };

test('step 1 has no paste box; a video without time codes still gets through steps 2 and 3', async () => {
  const calls = server({ preview: () => ok(NO_CODES) });
  await fetchStep();
  assert.equal(q('.wiz-paste'), null);
  assert.equal(post(calls, '/albums/from-video/preview').allowEmpty, true);
  assert.match(stepText(), /Details/);
  assert.equal(q('.wiz-source').textContent, 'Topic · Hallucinogen - Twisted (1995) [FULL ALBUM] · 20:00');
  await go();
  await settle();
  assert.match(stepText(), /Review/);
  D().close();
});

test('Review of a video without time codes is empty with the paste action; lengths-only text is sent as time codes and fills the matches', async () => {
  const calls = server({ preview: () => ok(NO_CODES) });
  await fetchStep();
  await go();
  await settle();
  assert.equal(rows().filter((r) => r.querySelector('select')).length, 4);
  assert.match(q('.wiz-no-tracks').textContent, /No time codes were found/);
  assert.equal(q('.wiz-no-tracks').hidden, false);
  assert.equal(nextBtn().disabled, true);
  assert.match(q('.av-problems').textContent, /Tick at least one track/);
  const toggle = q('.wiz-paste-toggle');
  assert.equal(toggle.textContent, 'No time codes? Paste a track list');
  assert.equal(q('.wiz-paste').hidden, true);
  fire(toggle, 'click');
  assert.equal(q('.wiz-paste').hidden, false);
  type(q('.wiz-paste textarea'), '1 Hallucinogen - LSD 5:00\n2 Snakey Shaker 4:40\n3 Gloople 8:20');
  fire(q('.wiz-paste-apply'), 'click');
  await settle();
  assert.equal(post(calls, '/albums/from-video/preview-text').text, '00:00:00 Hallucinogen - LSD\n00:05:00 Snakey Shaker\n00:09:40 Gloople');
  assert.match(stepText(), /Review/);
  assert.equal(q('.wiz-no-tracks').hidden, true);
  assert.equal(q('.wiz-paste-toggle').textContent, 'Edit or paste a track list');
  assert.ok(rows().some((r) => /LSD/.test(r.textContent)));
  assert.equal(nextBtn().disabled, false);
  D().close();
});

test('pasted text with no tracks keeps the paste box with a hint and changes nothing', async () => {
  server({ preview: () => ok(NO_CODES), previewText: () => ({ status: 422, body: {} }) });
  await fetchStep();
  await go();
  await settle();
  fire(q('.wiz-paste-toggle'), 'click');
  type(q('.wiz-paste textarea'), 'nothing useful');
  fire(q('.wiz-paste-apply'), 'click');
  await settle();
  assert.match(q('.wiz-paste-note').textContent, /No tracks found in this text/);
  assert.equal(q('.wiz-paste').hidden, false);
  assert.equal(nextBtn().disabled, true);
  D().close();
});

test('a video with time codes offers "Edit or paste a track list" in Review', async () => {
  server();
  await fetchStep();
  await go();
  await settle();
  assert.equal(q('.wiz-no-tracks').hidden, true);
  assert.equal(q('.wiz-paste-toggle').textContent, 'Edit or paste a track list');
  D().close();
});

test('preview errors are plain: 404, 413, unreachable and offline', async () => {
  server({ preview: () => ({ status: 404, body: { detail: 'not_found' } }) });
  await fetchStep();
  assert.match(q('.wiz-msg').textContent, /no video at this address, or it is private/);
  D().close();
  server({ preview: () => ({ status: 413, body: { detail: 'video longer than 4 hours' } }) });
  await fetchStep();
  assert.match(q('.wiz-msg').textContent, /longer than 4 hours/);
  D().close();
  globalThis.fetch = async () => { throw new Error('down'); };
  await fetchStep();
  assert.match(q('.wiz-msg').textContent, /could not be reached/);
  D().close();
  const real = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  server();
  openAddAlbum();
  type(q('#wiz-url'), VIDEO);
  await go();
  assert.match(q('.wiz-msg').textContent, /You are offline/);
  Object.defineProperty(globalThis, 'navigator', { value: real, configurable: true });
  D().close();
});

test('a Mix and a private list are refused on step 1', async () => {
  const calls = server();
  openAddAlbum();
  type(q('#wiz-url'), 'https://www.youtube.com/playlist?list=RDyeUFSnA9Puk');
  await go();
  assert.match(q('.wiz-msg').textContent, /Mix/);
  type(q('#wiz-url'), 'https://www.youtube.com/playlist?list=WL');
  await go();
  assert.match(q('.wiz-msg').textContent, /private/);
  assert.equal(calls.length, 0);
  D().close();
});

test('a playlist goes through the same steps and commits with trackNo, coverToSongs and the playlist address', async () => {
  const calls = server();
  await fetchStep(LIST);
  assert.deepEqual(post(calls, '/albums/youtube/preview'), { url: LIST });
  assert.equal(q('.wiz-source').textContent, 'Topic · Twisted · 3 tracks · 20:00');
  assert.equal(q('.wiz-source a').getAttribute('href'), 'https://www.youtube.com/playlist?list=PLabcdefghij');
  await go();
  await settle();
  assert.match(nextBtn().textContent, /^Import and download 2 tracks$/);
  assert.match(q('.wiz-quota, .album-quota').textContent, /up to 20 fetches an hour/);
  fire(nextBtn(), 'click');
  await settle();
  const body = post(calls, '/albums/youtube/commit');
  assert.equal(body.playlistUrl, LIST);
  assert.equal(body.coverToSongs, true);
  assert.equal(body.album.coverUrl, 'https://img.discogs.com/c.jpg');
  assert.deepEqual(body.selected.map((s) => [s.position, s.trackNo]), [[1, 1], [2, 3], [3, 4]]);
  assert.match(stepText(), /Step 5 of 5/);
  assert.match(q('.wiz-run').textContent, /Album created, 3 songs added/);
  fire(qa('button').find((b) => b.textContent === 'Open the album'), 'click');
  assert.equal(globalThis.location.hash, '#/library/albums/alb_2');
});

test('a playlist with no playable videos says so', async () => {
  server({ playlist: () => ok({ ...PL, tracks: [] }) });
  await fetchStep(LIST);
  assert.match(q('.wiz-msg').textContent, /no playable videos/);
  D().close();
});

test('changing the address after edits asks once before replacing them', async () => {
  const calls = server();
  await fetchStep();
  setToken(tokenFields()[1], 'Twisted 2');
  fire(backBtn(), 'click');
  await settle();
  type(q('#wiz-url'), 'https://youtu.be/zzzzzzzzzzz');
  await go();
  assert.match(q('.wiz-msg').textContent, /Start over from this link/);
  assert.equal(q('.wiz-fetch').getAttribute('aria-label'), 'Replace my edits');
  assert.equal(count(calls, '/albums/from-video/preview'), 1);
  await go();
  assert.equal(count(calls, '/albums/from-video/preview'), 2);
  D().close();
});

test('the step line is a polite status and the dots are decoration; each step has a heading to focus', async () => {
  server();
  openAddAlbum();
  assert.equal(q('.wiz-stepline').getAttribute('role'), 'status');
  assert.equal(q('.wiz-dots').getAttribute('aria-hidden'), 'true');
  assert.equal(q('.wiz-dots li[data-step="link"]').getAttribute('aria-current'), 'step');
  assert.equal(q('.wiz-heading').getAttribute('tabindex'), '-1');
  D().close();
});

test('closing stops any work and clears the dialog', async () => {
  server();
  await fetchStep();
  D().close();
  assert.equal(D().children.length, 0);
});

test('required fields: an empty album name or a bad year stops step 2', async () => {
  const calls = server();
  await fetchStep();
  setToken(tokenFields()[1], '');
  await go();
  assert.match(q('.wiz-msg').textContent, /Give the album a name/);
  setToken(tokenFields()[1], 'Twisted');
  type(yearIn(), '19');
  await go();
  assert.match(q('.wiz-msg').textContent, /four digits/);
  assert.equal(count(calls, '/albums/discogs/search'), 0);
  D().close();
});

test('the genre pills are editable: remove one, add from the list, free text is refused', async () => {
  server({ suggest: () => ok({ suggestions: [{ name: 'Techno', source: 'discogs', mapped: 'Techno', unmapped: false }, { name: 'Dub', source: 'discogs', mapped: 'Dub', unmapped: false }], wikipediaPage: null, searchError: null }) });
  await fetchStep();
  await go();
  await settle();
  const chips = () => qa('.wiz-review .chips .chip.tint').map((c) => c.textContent);
  assert.deepEqual(chips(), ['Techno', 'Dub']);
  fire(qa('.wiz-review .x').find((b) => b.getAttribute('aria-label') === 'Remove Dub'), 'click');
  assert.deepEqual(chips(), ['Techno']);
  const input = q('.wiz-review .chip-field input');
  input.value = 'amb';
  fire(input, 'input');
  const opts = qa('.wiz-review [role=option]');
  assert.deepEqual(opts.map((o) => o.dataset.genre), ['Ambient']);
  fire(opts[0], 'click');
  assert.deepEqual(chips(), ['Techno', 'Ambient']);
  input.value = 'Nonsense';
  fire(input, 'keydown', { key: 'Enter' });
  assert.deepEqual(chips(), ['Techno', 'Ambient']);
  assert.match(q('.wiz-review .genre-hint').textContent, /not in the genre list/);
  input.value = '';
  D().close();
});

test('a failed job shows the error with Try again; retry posts the same body again', async () => {
  let creates = 0;
  const calls = server({ create: () => { creates += 1; return ok({ jobId: 'j1', albumId: 'alb_1', songIds: [] }, 202); }, job: (n) => (n === 1 ? ok({ state: 'error', done: 1, total: 2, error: 'ffmpeg failed' }) : ok({ state: 'done', done: 2, total: 2 })) });
  await fetchStep();
  await go();
  await settle();
  fire(nextBtn(), 'click');
  await settle();
  assert.ok(await until(() => !!q('.av-progress-actions .msg.error')));
  assert.match(q('.av-progress-actions .msg.error').textContent, /ffmpeg failed/);
  assert.ok(qa('.av-progress-actions button').some((b) => b.textContent === 'Open the album'));
  fire(qa('button').find((b) => b.textContent === 'Try again'), 'click');
  assert.ok(await until(() => D().open === false, 5000));
  assert.equal(creates, 2);
  const sent = calls.filter((c) => c.url === '/albums/from-video');
  assert.deepEqual(JSON.parse(sent[0].opts.body), JSON.parse(sent[1].opts.body));
});

test('closing the dialog during the split stops the polling', async () => {
  const calls = server({ job: () => ok({ state: 'splitting', done: 0, total: 2 }) });
  await fetchStep();
  await go();
  await settle();
  fire(nextBtn(), 'click');
  await settle();
  D().close();
  const n = count(calls, '/jobs/j1');
  await sleep(50);
  assert.equal(count(calls, '/jobs/j1'), n);
});

test('backdrop: a plain backdrop click closes the empty first step but not a started draft', async () => {
  server();
  openAddAlbum();
  D().onclick({ target: D(), clientX: undefined });
  assert.equal(D().open, false);
  await fetchStep();
  D().onclick({ target: D(), clientX: undefined });
  assert.equal(D().open, true);
  D().close();
});
