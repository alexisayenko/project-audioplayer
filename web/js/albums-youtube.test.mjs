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
const { mountAlbums, openAddAlbum, youtubeErrorText, matchMap, autoMatch, candidatePayload } = await import('./albums.js');
const yt = await import('./albums-youtube.js');
const { autodl } = await import('./autodl.js');

const PLAYLIST = 'https://www.youtube.com/playlist?list=PLabc123';
const DISCOGS = 'https://www.discogs.com/release/545650-Derango-Tumult';
const ok = (body, status = 200) => ({ status, body });
const D = () => document.getElementById('add-dialog');
const q = (s) => D().querySelector(s);
const qa = (s) => [...D().querySelectorAll(s)];
const toastText = () => document.getElementById('toast').textContent;
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
async function until(cond, ms = 6000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(20);
  return cond();
}
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush(); };

const TRACKS = [
  { position: 1, videoId: 'aaaaaaaaaaa', title: 'Intro (official video)', durationS: 60, songId: null },
  { position: 2, videoId: 'bbbbbbbbbbb', title: 'Noise', durationS: 200, songId: null },
  { position: 3, videoId: 'ccccccccccc', title: 'Noise (remix)', durationS: 210, songId: 'in1' },
];
const DTRACKS = [{ no: 1, title: 'Intro', durationS: 65 }, { no: 2, title: 'Noise', durationS: 200 }];
const CAND1 = {
  url: DISCOGS, discogsId: 545650, title: 'Tumult', artist: 'Derango', year: 2004, trackCount: 2, score: 0.9, best: true,
  thumb: 'https://img.discogs.com/a.jpg', formats: ['Vinyl', 'LP', 'Limited Edition'], labels: ['Sonic Records'], catno: 'SON 12', country: 'Germany',
  genres: ['Techno'], tracks: DTRACKS,
  matches: { 1: 1, 2: 2, 3: null },
};
const CAND2 = {
  url: 'https://www.discogs.com/release/2', discogsId: 2, title: 'Tumult (Reissue)', artist: 'Derango', year: 2010, trackCount: 3, score: 0.6,
  tracks: [...DTRACKS, { no: 3, title: 'Noise Remix', durationS: 210 }],
  matches: { 1: 1, 2: 2, 3: 3 },
};

function preview(extra = {}) {
  return {
    playlist: { title: 'Derango - Tumult (full album)', uploader: 'x', count: 3 },
    guess: { artist: 'Derango', album: 'Tumult', year: 2004 },
    tracks: TRACKS, candidates: [CAND1, CAND2], ...extra,
  };
}

function server({ pv = () => ok(preview()), audio = () => ok({ status: 'done' }), search = () => ok({ candidates: [CAND2] }), commit = null, me = { owner: false } } = {}) {
  const have = new Set();
  const calls = stubFetch((u, o) => {
    if (u === '/albums/youtube/preview') return pv();
    if (u === '/albums/youtube/commit') return commit ? commit(o) : ok({ album: { id: 'alb_9', title: 'Tumult' }, songs: [{ position: 1, songId: 'n1' }, { position: 2, songId: 'n2' }], linked: 2, unlinked: 1 }, 201);
    if (u === '/albums/discogs-search') return search(o);
    if (u === '/albums/preview') return ok({ title: 'Pasted', artist: 'Derango', year: 2001, source: { type: 'discogs', id: '7', url: 'https://www.discogs.com/release/7' }, genres: [], tracks: [{ no: 1, title: 'Intro', durationS: 10 }, { no: 2, title: 'Noise', durationS: 20 }] });
    if (u === '/me') return ok(me);
    if (u === '/albums') return ok([]);
    if (u === '/library') return ok({ songs: [...have].map((id) => ({ id, title: id, artist: 'Derango', file: `${id}.mp3`, duration: 60 })) });
    const m = /^\/songs\/([^/]+)\/audio$/.exec(u);
    if (m) {
      const r = audio(m[1]);
      if (r.status === 200) have.add(m[1]);
      return r;
    }
    return ok({});
  });
  return { calls, have };
}

async function popup(address = PLAYLIST) {
  openAddAlbum();
  q('.well input').value = address;
  fire(q('.well'), 'submit');
  await settle();
}
const body = (d, url) => JSON.parse(d.calls.find((c) => c.url === url).opts.body);
const rows = () => qa('li.album-yt-track');
const counter = () => q('.album-yt-count').textContent;
const create = () => qa('button').find((b) => /^Create album/.test(b.textContent));

test('matching helpers', () => {
  assert.equal(matchMap(CAND1).get(2).no, 2);
  assert.equal(matchMap({}).size, 0);
  const auto = autoMatch([{ position: 1, title: 'Intro' }, { position: 2, title: 'Noise' }], DTRACKS);
  assert.deepEqual(auto, { 1: 1, 2: 2 });
  assert.deepEqual(autoMatch([{ position: 5, title: 'x' }, { position: 6, title: 'y' }], DTRACKS), { 5: 1, 6: 2 });
  assert.equal(matchMap(CAND1).get(2).title, 'Noise');
  assert.equal(matchMap(CAND1).has(3), false);
  const p = candidatePayload(CAND1, PLAYLIST);
  assert.deepEqual(p.links, { discogs: DISCOGS, youtube: PLAYLIST });
  assert.equal(p.discogsId, 545650);
  assert.equal('source' in p, false);
});

test('URL detection: Discogs keeps the preview flow, a playlist uses the YouTube preview, Mix and private lists are refused', async () => {
  const d = server();
  await popup(DISCOGS);
  assert.ok(d.calls.some((c) => c.url === '/albums/preview'));
  assert.equal(d.calls.some((c) => c.url === '/albums/youtube/preview'), false);
  D().close();

  const e = server();
  await popup(PLAYLIST);
  assert.ok(e.calls.some((c) => c.url === '/albums/youtube/preview'));
  assert.equal(e.calls.some((c) => c.url === '/albums/preview'), false);
  D().close();

  for (const bad of ['https://www.youtube.com/playlist?list=RDabc123', 'https://www.youtube.com/playlist?list=WL']) {
    const f = server();
    await popup(bad);
    assert.ok(q('.msg.error'));
    assert.equal(f.calls.length, 0);
    D().close();
  }
});

test('the preview creates nothing: no album, no commit, no audio fetch; Cancel closes without any request', async () => {
  const d = server();
  await popup();
  assert.equal(body(d, '/albums/youtube/preview').url, PLAYLIST);
  assert.match(q('.album-yt-head').textContent, /Derango - Tumult \(full album\)/);
  assert.match(q('.album-guess').textContent, /Derango - Tumult · 2004/);
  const before = d.calls.length;
  fire(qa('button').find((b) => b.textContent === 'Cancel' && !b.closest('.dlg-head')), 'click');
  await settle();
  assert.equal(D().open, false);
  assert.equal(d.calls.length, before);
  assert.equal(d.calls.some((c) => c.url === '/albums/youtube/commit' || (c.url === '/albums' && c.opts.method === 'POST') || /\/audio$/.test(c.url)), false);
});

test('the best candidate is preselected and collapsed; Change expands radios; Open on Discogs opens in a new tab', async () => {
  server();
  await popup();
  assert.equal(qa('input[type=radio]').length, 1);
  const row = q('.album-cand-radio');
  assert.equal(row.querySelector('.album-cand-title').textContent, 'Derango - Tumult');
  assert.equal(row.querySelector('.album-cand-sub').textContent, '2004 · 2 tracks');
  assert.equal(row.querySelector('.album-cand-meta').textContent, 'Vinyl, LP, Limited Edition · Sonic Records (SON 12) · Germany');
  assert.equal(row.querySelector('.album-best').textContent, 'Best match');
  assert.equal(row.querySelector('img.cover').getAttribute('loading'), 'lazy');
  assert.equal(row.querySelector('input').checked, true);
  const open = q('.album-open-discogs');
  assert.equal(open.getAttribute('href'), DISCOGS);
  assert.equal(open.getAttribute('target'), '_blank');
  assert.match(open.getAttribute('rel'), /noopener/);
  const change = q('.album-change');
  assert.equal(change.getAttribute('aria-expanded'), 'false');
  fire(change, 'click');
  assert.equal(qa('input[type=radio]').length, 2);
  assert.equal(q('.album-change').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(qa('input[type=radio]').map((r) => r.checked), [true, false]);
  D().close();
});

test('mapping and defaults: matched tracks checked, unmatched unchecked, In library tag, counter; the candidate switch recomputes unless toggled', async () => {
  server();
  await popup();
  assert.equal(rows().length, 3);
  assert.deepEqual(rows().map((r) => r.querySelector('input').checked), [true, true, false]);
  assert.match(rows()[0].querySelector('.album-match').textContent, /→ 1\. Intro/);
  assert.equal(rows()[2].querySelector('.album-match').textContent, 'no match');
  assert.ok(rows()[2].querySelector('.album-in-library'));
  assert.equal(rows()[0].querySelector('.album-in-library'), null);
  assert.equal(counter(), '2 of 3 selected');

  fire(rows()[0].querySelector('input'), 'change', { currentTarget: null });
  D().querySelectorAll('li.album-yt-track input')[0].checked = false;
  fire(D().querySelectorAll('li.album-yt-track input')[0], 'change');
  assert.equal(counter(), '1 of 3 selected');

  fire(q('.album-change'), 'click');
  const second = qa('input[type=radio]')[1];
  second.checked = true;
  fire(second, 'change');
  assert.deepEqual(rows().map((r) => r.querySelector('input').checked), [false, true, true], 'row 1 was toggled by hand and keeps its state; row 3 now has a match');
  assert.match(rows()[2].querySelector('.album-match').textContent, /→ 3\. Noise Remix/);
  assert.equal(counter(), '2 of 3 selected');
  D().close();
});

test('toggling, Select all and Select none, and the Create label and state', async () => {
  server();
  await popup();
  assert.equal(create().textContent.trim(), 'Create album and download 2 tracks');
  const all = q('.album-select-all');
  assert.equal(all.textContent, 'Select all');
  fire(all, 'click');
  assert.equal(counter(), '3 of 3 selected');
  assert.equal(q('.album-select-all').textContent, 'Select none');
  assert.equal(create().textContent.trim(), 'Create album and download 2 tracks', 'the track already in the library is not downloaded again');
  fire(q('.album-select-all'), 'click');
  assert.equal(counter(), '0 of 3 selected');
  assert.equal(create().disabled, false, 'a chosen candidate still allows creating the album');
  assert.equal(create().textContent.trim(), 'Create album');
  D().close();
});

test('Search again sends the edited names and the playlist tracks and replaces the list', async () => {
  const d = server();
  await popup();
  qa('.album-search input')[0].value = 'Someone';
  fire(qa('.album-search input')[0], 'input');
  fire(q('.album-search'), 'submit');
  await settle();
  const s = body(d, '/albums/discogs-search');
  assert.equal(s.artist, 'Someone');
  assert.equal(s.album, 'Tumult');
  assert.equal(s.trackCount, 3);
  assert.deepEqual(s.playlistTracks.map((t) => t.position), [1, 2, 3]);
  assert.equal(qa('input[type=radio]').length, 1);
  assert.equal(q('.album-cand-title').textContent, 'Derango - Tumult (Reissue)');
  assert.deepEqual(rows().map((r) => r.querySelector('input').checked), [true, true, true]);
  D().close();
});

test('Create album and download sends the commit payload, closes, then starts the downloads and toasts', async () => {
  const d = server();
  await popup();
  fire(create(), 'click');
  await settle(8);
  const c = body(d, '/albums/youtube/commit');
  assert.equal(c.playlistUrl, PLAYLIST);
  assert.deepEqual(c.selected, [{ position: 1, videoId: 'aaaaaaaaaaa', title: 'Intro (official video)', durationS: 60 }, { position: 2, videoId: 'bbbbbbbbbbb', title: 'Noise', durationS: 200 }]);
  assert.deepEqual(c.mapping, { 1: 1, 2: 2 });
  assert.equal(c.candidate.title, 'Tumult');
  assert.equal(c.candidate.artist, 'Derango');
  assert.equal(c.candidate.year, 2004);
  assert.deepEqual(c.candidate.genres, ['Techno']);
  assert.equal(c.candidate.discogsId, 545650);
  assert.deepEqual(c.candidate.links, { discogs: DISCOGS, youtube: PLAYLIST });
  assert.equal(c.candidate.tracks.length, 2);
  assert.deepEqual(c.fallback, { title: 'Tumult', artist: 'Derango', year: 2004 });
  assert.equal(D().open, false);
  assert.equal(await until(() => d.calls.filter((x) => /\/audio$/.test(x.url)).length === 2), true);
  assert.deepEqual(d.calls.filter((x) => /\/audio$/.test(x.url)).map((x) => x.url), ['/songs/n1/audio', '/songs/n2/audio']);
  assert.equal(await until(() => /Downloaded 2 songs/.test(toastText())), true);
});

test('the commit toast reports linked, unmatched and the tracks being downloaded', async () => {
  server({ audio: () => ({ status: 429, body: { error: 'hourly_limit', retry_after_minutes: 1 } }) });
  await popup();
  fire(create(), 'click');
  await settle(10);
  assert.match(toastText(), /Album created, 2 songs linked, 1 not matched; downloading 2 tracks|Paused: hourly limit/);
  await until(() => yt.jobState()?.paused > 0);
  autodl.cancel(['n1', 'n2']);
});

test('no candidates: say so, fallback fields prefilled from the guess, commit has no candidate', async () => {
  const d = server({ pv: () => ok(preview({ candidates: [] })) });
  await popup();
  assert.match(q('.album-picker').textContent, /No matching releases found/);
  assert.equal(qa('.album-fallback input').length, 3);
  assert.deepEqual(qa('.album-fallback input').map((i) => i.value), ['Tumult', 'Derango', '2004']);
  assert.deepEqual(rows().map((r) => r.querySelector('input').checked), [true, true, true]);
  assert.equal(rows()[0].querySelector('.album-match'), null);
  qa('.album-fallback input')[0].value = 'My title';
  fire(qa('.album-fallback input')[0], 'input');
  fire(create(), 'click');
  await settle(8);
  const c = body(d, '/albums/youtube/commit');
  assert.equal(c.candidate, null);
  assert.deepEqual(c.mapping, {});
  assert.deepEqual(c.selected.map((x) => x.position), [1, 2, 3]);
  assert.deepEqual(c.fallback, { title: 'My title', artist: 'Derango', year: 2004 });
  autodl.cancel(['n1', 'n2']);
});

test('a search error is shown and the album can still be created from the playlist alone', async () => {
  server({ pv: () => ok(preview({ candidates: [], searchError: 'discogs_unavailable' })) });
  await popup();
  assert.match(q('.album-picker').textContent, /Discogs is not available right now/);
  assert.ok(q('.album-fallback'));
  assert.equal(create().disabled, false);
  D().close();
});

test('Create is disabled with nothing selected and no candidate', async () => {
  server({ pv: () => ok(preview({ candidates: [] })) });
  await popup();
  fire(q('.album-select-all'), 'click');
  assert.equal(counter(), '0 of 3 selected');
  assert.equal(create().disabled, true);
  D().close();
});

test('the quota hint shows for a normal user and is hidden for the owner', async () => {
  server();
  await popup();
  assert.match(q('.album-quota').textContent, /2 selected, up to 20 fetches an hour, it pauses and resumes/);
  D().close();
  server({ me: { owner: true } });
  await popup();
  await settle();
  assert.equal(q('.album-quota'), null);
  D().close();
});

test('pasting a Discogs link after the preview adds that release and matches the tracks', async () => {
  const d = server({ pv: () => ok(preview({ candidates: [] })) });
  await popup();
  fire(qa('button').find((b) => b.textContent === 'Paste a Discogs link'), 'click');
  q('.well input').value = DISCOGS;
  fire(q('.well'), 'submit');
  await settle();
  assert.ok(d.calls.some((c) => c.url === '/albums/preview'));
  assert.equal(q('.album-cand-title').textContent, 'Derango - Pasted');
  assert.deepEqual(rows().map((r) => r.querySelector('input').checked), [true, true, false]);
  assert.equal(q('.album-fallback'), null);
  D().close();
});

test('start errors: 400, 404, 409 library_full_songs and 502', async () => {
  const cases = [[400, 'bad_url', /not a valid YouTube playlist/], [404, 'not_found', /no playlist/], [409, 'library_full_songs', /library is full/], [502, 'youtube_failed', /could not be read/]];
  for (const [status, error, re] of cases) {
    server({ pv: () => ({ status, body: { error, detail: error } }) });
    await popup();
    assert.match(q('.msg.error').textContent, re);
    assert.equal(q('.album-yt'), null);
    D().close();
  }
  assert.match(youtubeErrorText({ status: 418, message: 'x' }), /x/);
});

test('a commit error stays in the popup and keeps the choices', async () => {
  server({ commit: () => ({ status: 502, body: { error: 'youtube_failed' } }) });
  await popup();
  fire(create(), 'click');
  await settle(8);
  assert.match(q('.msg.error').textContent, /could not be read/);
  assert.equal(D().open, true);
  assert.equal(counter(), '2 of 3 selected');
  D().close();
});

test('hourly_limit pauses with a visible state and resumes when allowed', async () => {
  let limited = true;
  const d = server({ audio: () => (limited ? { status: 429, body: { error: 'hourly_limit', retry_after_minutes: 1 } } : ok({ status: 'done' })) });
  const pane = document.createElement('div');
  document.body.append(pane);
  const unmount = mountAlbums(pane, '');
  await unmount.ready;
  await popup();
  fire(create(), 'click');
  await settle(8);
  assert.equal(await until(() => yt.jobState()?.paused > 0), true);
  const line = pane.querySelector('.album-dl-status');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /Paused: hourly limit, resumes in 1 minute/);
  assert.ok(line.querySelector('button'));
  limited = false;
  const realNow = Date.now;
  Date.now = () => realNow() + 61 * 60000;
  try {
    fire(line.querySelector('button'), 'click');
    assert.equal(await until(() => yt.jobState() === null, 8000), true);
  } finally {
    Date.now = realNow;
  }
  assert.equal(d.calls.filter((c) => /\/audio$/.test(c.url)).length >= 2, true);
  assert.match(toastText(), /Downloaded 2 songs/);
  assert.equal(pane.querySelector('.album-dl-status').hidden, true);
  unmount();
});

test('songs that already have audio are skipped', async () => {
  const d = server();
  d.have.add('e1');
  const n = await yt.startDownloads(['e1']);
  assert.equal(n, 0);
  assert.equal(d.calls.some((c) => c.url === '/songs/e1/audio'), false);
});
