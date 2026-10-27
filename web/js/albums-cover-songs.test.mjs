import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush, fire } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const { store } = await import('./store.js');
const { albumCoverSection, songsResult } = await import('./albums-cover.js');

const ok = (body, status = 200) => ({ status, body });
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush(); };
const SONGS = [{ id: 'aaaaaaaaaaa', title: 'One' }, { id: 'bbbbbbbbbbb', title: 'Two' }];
const ALBUM = {
  id: 'alb_1', title: 'Tumult', artist: 'Derango', cover: { source: 'discogs', url: 'https://img.discogs.com/a.jpg' }, coverUrl: '/albums/alb_1/cover?v=abc', coverFrom: 'album',
  tracks: [{ no: 1, title: 'One', songId: 'aaaaaaaaaaa' }, { no: 2, title: 'Two', songId: 'bbbbbbbbbbb' }, { no: 3, title: 'Three', songId: null }],
};

function section(album, answers, songs = SONGS) {
  store.songs = songs;
  const calls = stubFetch((u, o) => {
    if (u.endsWith('/cover/candidates')) return ok({ candidates: [] });
    if (u === '/library') return ok({ songs });
    if (u.endsWith('/cover/to-songs')) { const a = answers.shift(); return a.status ? a : ok(a); }
    return ok({});
  });
  const sec = albumCoverSection({ ...album }, () => {});
  document.body.append(sec.node);
  const btn = sec.node.querySelector('.album-cover-songs');
  const hint = sec.node.querySelector('.album-cover-songs-hint');
  const posts = () => calls.filter((c) => c.url.endsWith('/cover/to-songs')).map((c) => JSON.parse(c.opts.body));
  return { sec, calls, btn, hint, posts, msg: () => [...sec.node.querySelectorAll('[role=status]')].map((n) => n.textContent).filter(Boolean).at(-1) };
}

test('songsResult words each outcome', () => {
  assert.equal(songsResult({ linked: 7, applied: 7, unchanged: 0, skipped: 0, failed: 0 }), 'Set art on 7 songs');
  assert.equal(songsResult({ linked: 1, applied: 1, unchanged: 0, skipped: 0, failed: 0 }), 'Set art on 1 song');
  assert.equal(songsResult({ linked: 2, applied: 0, unchanged: 2, skipped: 0, failed: 0 }), '2 songs already had this art');
  assert.match(songsResult({ linked: 3, applied: 1, unchanged: 0, skipped: 2, failed: 0 }), /^Set art on 1 song\. 2 songs kept their own art: click again/);
  assert.match(songsResult({ linked: 3, applied: 2, unchanged: 0, skipped: 0, failed: 1 }), /1 song failed/);
});

test('the button is labelled, enabled with an own cover and linked songs, and posts overwrite false', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 2, unchanged: 0, skipped: 0, failed: 0 }]);
  assert.equal(s.btn.textContent, 'Use for songs');
  assert.equal(s.btn.getAttribute('title'), 'Use this cover for all linked songs');
  assert.equal(s.btn.disabled, false);
  assert.equal(s.hint.hidden, true);
  fire(s.btn, 'click');
  await settle();
  assert.deepEqual(s.posts(), [{ overwrite: false }]);
  assert.ok(s.calls.some((c) => c.url === '/library'), 'the library is reloaded so the songs show the new art');
  assert.equal(document.getElementById('toast').textContent, 'Set art on 2 songs');
  assert.equal(s.btn.disabled, false);
});

test('songs with their own art ask first: the next click replaces them with overwrite true', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 1, unchanged: 0, skipped: 1, failed: 0 }, { linked: 2, applied: 1, unchanged: 0, skipped: 0, failed: 0 }]);
  fire(s.btn, 'click');
  await settle();
  assert.equal(s.btn.textContent, 'Replace art on 1 song');
  assert.match(s.msg(), /1 song kept their own art/);
  fire(s.btn, 'click');
  await settle();
  assert.deepEqual(s.posts(), [{ overwrite: false }, { overwrite: true }]);
  assert.equal(s.btn.textContent, 'Use for songs');
  assert.equal(document.getElementById('toast').textContent, 'Set art on 1 song');
});

test('disabled with a hint when the album has no cover of its own or no linked song exists', () => {
  const none = section({ ...ALBUM, cover: { source: null, url: null }, coverUrl: '/covers/x', coverFrom: 'song' }, []);
  assert.equal(none.btn.disabled, true);
  assert.equal(none.hint.textContent, 'Set a cover of its own first');
  assert.equal(none.hint.hidden, false);
  const bare = section({ ...ALBUM, tracks: [{ no: 1, title: 'One', songId: null }] }, []);
  assert.equal(bare.btn.disabled, true);
  assert.equal(bare.hint.textContent, 'No linked songs');
  const gone = section(ALBUM, [], []);
  assert.equal(gone.btn.disabled, true, 'a link to a song that is not in the library does not count');
});

test('failures stay inline and keep the button usable', async () => {
  const s = section(ALBUM, [{ linked: 2, applied: 1, unchanged: 0, skipped: 0, failed: 1 }, { status: 409, body: { detail: 'no_cover' } }]);
  fire(s.btn, 'click');
  await settle();
  assert.match(s.msg(), /Set art on 1 song\. 1 song failed/);
  assert.equal(s.btn.disabled, false);
  fire(s.btn, 'click');
  await settle();
  assert.equal(s.msg(), 'Set a cover of its own first.');
  assert.equal(s.btn.disabled, false);
});
