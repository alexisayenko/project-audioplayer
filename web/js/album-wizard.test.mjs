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
    if (u === '/library') return ok({ songs: o.library || [] });
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
  assert.equal(link.textContent, 'Topic · Hallucinogen - Twisted (1995) [FULL ALBUM]');
  const tail = q('.wiz-source .wiz-source-tail');
  assert.equal(tail.textContent, ' · 3 tracks · 20:00');
  assert.equal(tail.closest('a'), null);
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

test('a channel name used as the artist shows no hint; only channel and title are the link', async () => {
  server({ preview: () => ok({ ...PV, uploader: 'Panayotis Kritidis', title: 'Total Eclipse Delta Aquarids', album: { ...PV.album, albumArtist: 'Panayotis Kritidis', title: 'Total Eclipse Delta Aquarids' } }) });
  await fetchStep();
  assert.doesNotMatch(q('.wiz-details').textContent, /channel name/);
  assert.deepEqual(pills(tokenFields()[0]), ['Panayotis Kritidis']);
  assert.match(q('.wiz-source').textContent, /^Panayotis Kritidis · Total Eclipse Delta Aquarids · 3 tracks · 20:00$/);
  assert.equal(q('.wiz-source a').textContent, 'Panayotis Kritidis · Total Eclipse Delta Aquarids');
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

test('the Review step has no "Use the Discogs title" checkbox and shows the Discogs title on matched rows', async () => {
  server();
  await fetchStep();
  await go();
  assert.equal(q('.av-use-disc'), null);
  assert.equal(D().textContent.includes('Use the Discogs title'), false);
  assert.match(rows()[2].querySelector('.av-label').textContent, /^Gloople \[Remix\]$/);
  assert.equal(rows()[2].querySelector('input.av-title').value, 'Gloople');
  assert.equal(rows()[2].querySelector('input.av-version').value, 'Remix');
  D().close();
});

test('editing the title of a matched row keeps the edit as the final title', async () => {
  const calls = server();
  await fetchStep();
  await go();
  const row = rows()[2];
  type(row.querySelector('input.av-title'), 'Gloople Reloaded');
  assert.match(row.querySelector('.av-label').textContent, /^Gloople Reloaded \[Remix\]$/);
  D().close();
  assert.equal(count(calls, '/albums/from-video'), 0);
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

const TWO = () => ok({ candidates: [MASTER, { ...MASTER, id: 8, year: 1996 }], searchError: null });
const LINKED = { ...RESOLVED, kind: 'release', id: 123, url: 'https://www.discogs.com/release/123', title: 'Linked Album', year: 1997, cover: 'https://img.discogs.com/l.jpg', trackCount: 4 };
const discUrl = () => q('#wiz-discogs-url');
const useBtn = () => q('.wiz-use');
const pasteLink = async (text) => { type(discUrl(), text); fire(useBtn(), 'click'); await settle(); };
const pickRadio = (i) => { const r = qa('.wiz-cand input')[i]; r.checked = true; fire(r, 'change'); };

test('step 3 always has the Paste a Discogs link field with the Use button inside it', async () => {
  server({ find: TWO });
  await fetchStep();
  await go();
  assert.match(q('label[for="wiz-discogs-url"]').textContent, /Paste a Discogs link/);
  assert.equal(useBtn().parentNode, discUrl().parentNode);
  assert.equal(useBtn().disabled, true);
  type(discUrl(), 'r1');
  assert.equal(useBtn().disabled, false);
  D().close();
  server({ find: () => ok({ candidates: [], searchError: null }) });
  await fetchStep();
  await go();
  assert.match(q('.wiz-pick').textContent, /No match on Discogs/);
  assert.ok(discUrl() && useBtn());
  D().close();
});

test('a pasted release link is read, listed first as "From your link", selected, and used by the later steps', async () => {
  const calls = server({ find: TWO, resolve: () => ok({ candidate: LINKED, searchError: null }) });
  await fetchStep();
  await go();
  await pasteLink('https://www.discogs.com/de/release/123-Linked-Album?ev=x');
  assert.deepEqual(post(calls, '/albums/discogs/resolve'), { kind: 'release', id: 123 });
  const cands = qa('.wiz-cand');
  assert.equal(cands.length, 4);
  assert.match(cands[0].textContent, /Hallucinogen - Linked Album/);
  assert.match(cands[0].textContent, /From your link/);
  assert.equal(cands[0].querySelector('input').checked, true);
  assert.equal(q('.wiz-link-error').hidden, true);
  await go();
  assert.equal(count(calls, '/albums/discogs/resolve'), 1);
  assert.match(stepText(), /^Step 4 of 5 · Review$/);
  assert.equal(rows().length, 4);
  assert.equal(linkIn('discogs').value, 'https://www.discogs.com/release/123');
  assert.equal(qa('.wiz-art-opt img')[0].getAttribute('src'), 'https://img.discogs.com/l.jpg');
  fire(backBtn(), 'click');
  await settle();
  assert.equal(discUrl().value, 'https://www.discogs.com/release/123');
  assert.equal(qa('.wiz-cand input')[0].checked, true);
  D().close();
});

test('a pasted link also works when the search found nothing, and Enter applies it', async () => {
  const calls = server({ find: () => ok({ candidates: [], searchError: null }), resolve: () => ok({ candidate: { ...LINKED, kind: 'master', id: 55, url: 'https://www.discogs.com/master/55' }, searchError: null }) });
  await fetchStep();
  await go();
  type(discUrl(), 'm55');
  fire(discUrl(), 'keydown', { key: 'Enter' });
  await settle();
  assert.deepEqual(post(calls, '/albums/discogs/resolve'), { kind: 'master', id: 55 });
  assert.equal(qa('.wiz-cand').length, 2);
  assert.equal(qa('.wiz-cand input')[0].checked, true);
  D().close();
});

test('clearing the pasted link removes its row and returns to the previous selection', async () => {
  server({ find: TWO, resolve: (o) => ok({ candidate: JSON.parse(o.body).id === 123 ? LINKED : RESOLVED, searchError: null }) });
  await fetchStep();
  await go();
  pickRadio(1);
  await pasteLink('https://www.discogs.com/release/123');
  assert.equal(qa('.wiz-cand').length, 4);
  assert.equal(qa('.wiz-cand input')[0].checked, true);
  type(discUrl(), '');
  assert.equal(qa('.wiz-cand').length, 3);
  assert.equal(qa('.wiz-cand input')[1].checked, true);
  assert.equal(qa('.wiz-cand input')[0].checked, false);
  D().close();
});

test('a pasted link to an album the search already listed shows once, as the link row', async () => {
  server({ find: TWO });
  await fetchStep();
  await go();
  await pasteLink('https://www.discogs.com/master/7-Twisted');
  assert.equal(qa('.wiz-cand').length, 3);
  assert.match(qa('.wiz-cand')[0].textContent, /From your link/);
  D().close();
});

test('None of these still works after a link was pasted', async () => {
  const calls = server({ find: TWO, resolve: () => ok({ candidate: LINKED, searchError: null }) });
  await fetchStep();
  await go();
  await pasteLink('r123');
  const none = q('.wiz-none input');
  none.checked = true;
  fire(none, 'change');
  await go();
  assert.match(stepText(), /Review/);
  assert.equal(count(calls, '/albums/discogs/resolve'), 1);
  assert.equal(rows().length, 3);
  D().close();
});

test('pasting something that is not a Discogs link, or a link that fails, is said inline and changes nothing', async () => {
  let answer = () => ok({ candidate: null, searchError: 'discogs_not_found' });
  const calls = server({ find: TWO, resolve: () => answer() });
  await fetchStep();
  await go();
  const err = () => q('.wiz-link-error');
  await pasteLink('https://example.com/release/123');
  assert.equal(err().hidden, false);
  assert.equal(err().textContent, 'This is not a Discogs release or master link.');
  assert.equal(count(calls, '/albums/discogs/resolve'), 0);
  await pasteLink('https://www.discogs.com/release/999');
  assert.match(err().textContent, /no album at this link/);
  answer = () => ok({ candidate: null, searchError: 'discogs_failed' });
  await pasteLink('https://www.discogs.com/release/999');
  assert.equal(err().textContent, 'Discogs did not answer, try again.');
  answer = () => ({ status: 429, body: { detail: 'rate' } });
  await pasteLink('https://www.discogs.com/release/999');
  assert.equal(err().textContent, 'Discogs did not answer, try again.');
  answer = () => ok({ candidate: null, searchError: 'discogs_unavailable' });
  await pasteLink('https://www.discogs.com/release/999');
  assert.match(err().textContent, /not set up on this server/);
  type(discUrl(), 'x');
  assert.equal(err().hidden, true);
  assert.equal(qa('.wiz-cand').length, 3);
  assert.equal(qa('.wiz-cand input').some((r) => r.checked), false);
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
  assert.doesNotMatch(q('.wiz-body').textContent, /Pick the genres that fit|Each shows where it came from/);
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
  assert.equal(linkIn('rateyourmusic').value, 'https://rateyourmusic.com/release/album/hallucinogen/twisted/');
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

const linkIn = (key) => q(`.wiz-links input[data-key="${key}"]`);
const linkOpen = (key) => linkIn(key).closest('.lk-row').querySelector('.lk-ico a');

test('the review has editable link rows with an open button on the left, prefilled with the found links', async () => {
  server();
  await fetchStep();
  await go();
  await settle();
  assert.equal(linkIn('discogs').value, 'https://www.discogs.com/master/7');
  assert.equal(linkIn('youtube').value, 'https://youtu.be/yeUFSnA9Puk');
  assert.equal(linkIn('rateyourmusic').value, '');
  const open = linkOpen('discogs');
  assert.equal(open.getAttribute('href'), 'https://www.discogs.com/master/7');
  assert.equal(open.getAttribute('target'), '_blank');
  assert.match(open.getAttribute('rel'), /noopener/);
  assert.equal(linkOpen('rateyourmusic'), null);
  assert.equal(linkIn('discogs').closest('.lk-row').firstElementChild.className, 'lk-ico');
  D().close();
});

test('edited, cleared and invalid link rows go into the create payload instead of the found ones', async () => {
  const calls = server();
  await fetchStep();
  await go();
  await settle();
  type(linkIn('discogs'), 'https://www.discogs.com/release/99');
  assert.equal(linkOpen('discogs').getAttribute('href'), 'https://www.discogs.com/release/99');
  type(linkIn('rateyourmusic'), 'https://rateyourmusic.com/release/album/h/t/');
  type(linkIn('youtube'), '');
  assert.equal(linkOpen('youtube'), null);
  type(linkIn('wikipedia'), 'not a link');
  assert.match(q('.wiz-links .lk-err:not([hidden])').textContent, /left out/);
  fire(nextBtn(), 'click');
  await settle();
  const links = post(calls, '/albums/from-video').album.links;
  assert.equal(links.discogs, 'https://www.discogs.com/release/99');
  assert.equal(links.rateyourmusic, 'https://rateyourmusic.com/release/album/h/t/');
  assert.equal('youtube' in links, false);
  assert.equal('wikipedia' in links, false);
});

test('a link row warns, but does not block, when the host looks wrong', async () => {
  const calls = server();
  await fetchStep();
  await go();
  await settle();
  type(linkIn('discogs'), 'https://example.com/x');
  assert.match(q('.wiz-links .lk-err:not([hidden])').textContent, /does not look like a Discogs address/);
  fire(nextBtn(), 'click');
  await settle();
  assert.equal(post(calls, '/albums/from-video').album.links.discogs, 'https://example.com/x');
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
  assert.doesNotMatch(q('.wiz-body').textContent, /Not on the Discogs list|Tick it to add/);
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

const LIBRARY = [
  { id: 'lib1', title: 'Elsewhere', mainArtists: ['Other'], featuredArtists: [], withArtists: [], version: null },
  { id: 'lib2', title: 'Else Where Too', mainArtists: ['Another'], featuredArtists: [], withArtists: [], version: null },
  { id: 'lib3', title: 'Unrelated', mainArtists: ['Nobody'], featuredArtists: [], withArtists: [], version: null },
];
const { store } = await import('./store.js');
const holdLibrary = (loaded = true) => { store.songs = loaded ? LIBRARY : []; store.loaded = loaded; store.pending = null; store.sig = null; };
const key = (node, k) => fire(node, 'keydown', { key: k });
const linkBtn = (row) => row.querySelector('.wiz-link-open');

async function openPicker(row, text) {
  fire(linkBtn(row), 'click');
  await settle();
  const input = row.querySelector('.wiz-songpick-input');
  if (text !== undefined) type(input, text);
  return input;
}

test('Link to a song in the library picks a song by search and sends its id for that row', async () => {
  holdLibrary(false);
  const calls = server({ library: LIBRARY });
  await fetchStep();
  await go();
  await settle();
  const row = rows()[0];
  assert.equal(linkBtn(row).textContent, 'Link to a song in the library');
  const input = await openPicker(row, 'else');
  assert.equal(input.getAttribute('role'), 'combobox');
  const items = () => [...row.querySelectorAll('.wiz-songpick-item')];
  assert.deepEqual(items().map((li) => li.getAttribute('data-song')), ['lib2', 'lib1']);
  key(input, 'ArrowDown');
  assert.equal(items()[1].getAttribute('aria-selected'), 'true');
  fire(items()[1], 'click');
  await settle();
  const after = rows()[0];
  assert.equal(after.querySelector('.wiz-linked').textContent, 'Linked: Other - Elsewhere');
  assert.equal(after.querySelector('.av-use input').checked, true);
  assert.equal(after.querySelector('.av-inc input').checked, true);
  assert.equal(linkBtn(after).textContent, 'Change song');
  fire(nextBtn(), 'click');
  await settle();
  const first = post(calls, '/albums/from-video').tracks[0];
  assert.deepEqual([first.include, first.useExistingSongId, first.title], [true, 'lib1', 'LSD']);
});

test('the picker closes on Escape without closing the dialog, and Enter picks the highlighted song', async () => {
  holdLibrary();
  server();
  await fetchStep();
  await go();
  await settle();
  const row = rows()[0];
  const input = await openPicker(row, 'unrel');
  key(input, 'Escape');
  assert.equal(row.querySelector('.wiz-songpick-slot').hidden, true);
  assert.equal(D().open, true);
  const again = await openPicker(row, 'unrel');
  key(again, 'Enter');
  await settle();
  assert.equal(rows()[0].querySelector('.wiz-linked').textContent, 'Linked: Nobody - Unrelated');
  D().close();
});

test('unlinking clears the link and unticks the row; a song linked twice moves and says used for track N', async () => {
  holdLibrary();
  const calls = server();
  await fetchStep();
  await go();
  await settle();
  const input = await openPicker(rows()[0], 'elsewhere');
  fire(rows()[0].querySelector('.wiz-songpick-item'), 'click');
  await settle();
  const second = rows().find((r) => r !== rows()[0] && linkBtn(r));
  await openPicker(second, 'elsewhere');
  assert.match(second.querySelector('.wiz-songpick-used').textContent, /^used for track \d+$/);
  fire(second.querySelector('.wiz-songpick-item'), 'click');
  await settle();
  assert.equal(input !== null, true);
  assert.equal(rows()[0].querySelector('.wiz-linked'), null);
  assert.equal(rows()[0].querySelector('.av-inc input').checked, false);
  const moved = rows().find((r) => r.querySelector('.wiz-linked'));
  assert.equal(moved.querySelector('.wiz-linked').textContent, 'Linked: Other - Elsewhere');
  fire(moved.querySelector('.wiz-linkctl .icon'), 'click');
  await settle();
  assert.equal(qa('.wiz-linked').length, 0);
  assert.equal(count(calls, '/albums/from-video'), 0);
  D().close();
});

test('a detected match keeps its chip and offers Link to another song', async () => {
  holdLibrary();
  server();
  await fetchStep();
  await go();
  await settle();
  const matched = rows().find((r) => r.textContent.includes('In library'));
  assert.equal(linkBtn(matched).textContent, 'Link to another song');
  D().close();
});

test('a playlist row is linked through the same picker and the commit body carries the song id', async () => {
  holdLibrary();
  const calls = server();
  await fetchStep(LIST);
  await go();
  await settle();
  const row = rows().find((r) => r.querySelector('.av-label').textContent === 'Spirit Guide');
  await openPicker(row, 'unrel');
  fire(row.querySelector('.wiz-songpick-item'), 'click');
  await settle();
  fire(nextBtn(), 'click');
  await settle();
  const sel = post(calls, '/albums/youtube/commit').selected;
  assert.deepEqual(sel.filter((s) => s.useExistingSongId).map((s) => [s.title, s.useExistingSongId]), [['Spirit Guide', 'lib3']]);
});

test('unknown_song on create clears every link and says so', async () => {
  holdLibrary();
  server({ create:() => ({ status: 422, body: { detail: 'unknown_song' } }) });
  await fetchStep();
  await go();
  await settle();
  await openPicker(rows()[0], 'unrel');
  fire(rows()[0].querySelector('.wiz-songpick-item'), 'click');
  await settle();
  fire(nextBtn(), 'click');
  await settle();
  assert.match(q('.wiz-msg').textContent, /no longer in your library/);
  assert.equal(qa('.wiz-linked').length, 0);
  D().close();
});
