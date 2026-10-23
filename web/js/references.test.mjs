import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
const R = await import('./references.js');

test('roles and source types have the labels from the spec', () => {
  assert.deepEqual(R.ROLES, ['archetype', 'origin', 'landmark', 'breakthrough']);
  assert.deepEqual(R.ROLES.map(R.roleLabel), ['Archetype', 'Origin', 'Landmark', 'Breakthrough']);
  assert.equal(R.sourceTypeLabel('rym'), 'Rate Your Music');
  assert.equal(R.sourceTypeLabel('nope'), 'Other');
});

test('sources: list, legacy source_url and count', () => {
  const two = { sources: [{ type: 'wikipedia', url: 'https://a.test/1' }, { type: 'chart', url: 'https://b.test/2' }], source_count: 2 };
  assert.equal(R.sourceCount(two), 2);
  assert.equal(R.sourcesTip(two), 'Wikipedia, Chart');
  assert.deepEqual(R.entrySources({ source_url: 'https://x.test/' }), [{ type: 'other', url: 'https://x.test/' }]);
  assert.equal(R.sourceCount({}), 0);
  assert.equal(R.sourceCount({ source_count: 3 }), 3);
});

test('addLinkFor prefers a non-chart YouTube or SoundCloud link, then the first link', () => {
  const yt = 'https://www.youtube.com/watch?v=abc';
  assert.equal(R.addLinkFor({ sources: [{ type: 'wikipedia', url: 'https://en.wikipedia.org/x' }, { type: 'chart', url: yt }, { type: 'other', url: 'https://soundcloud.com/a/b' }] }), 'https://soundcloud.com/a/b');
  assert.equal(R.addLinkFor({ sources: [{ type: 'discogs', url: 'https://discogs.test/1' }, { type: 'other', url: yt }] }), yt);
  assert.equal(R.addLinkFor({ sources: [{ type: 'chart', url: yt }, { type: 'discogs', url: 'https://discogs.test/1' }] }), yt);
  assert.equal(R.addLinkFor({ sources: [{ type: 'wikipedia', url: 'https://en.wikipedia.org/x' }] }), 'https://en.wikipedia.org/x');
  assert.equal(R.addLinkFor({ sources: [] }), null);
  assert.equal(R.isPlayableLink('https://notyoutube.com/x'), false);
});

test('cleanSources validates links, drops empty rows and caps at 8', () => {
  assert.deepEqual(R.cleanSources([{ type: 'rym', url: ' https://rym.test/a ', note: ' n ' }, { type: 'x', url: '', note: '' }]), { sources: [{ type: 'rym', url: 'https://rym.test/a', note: 'n' }], error: '' });
  assert.match(R.cleanSources([{ type: 'rym', url: 'ftp://a' }]).error, /http/);
  const nine = Array.from({ length: 9 }, (_, i) => ({ type: 'other', url: `https://a.test/${i}` }));
  assert.match(R.cleanSources(nine).error, /8/);
  assert.equal(R.cleanSources([{ type: 'weird', url: 'https://a.test/' }]).sources[0].type, 'other');
});

test('buildBody, patchBodyFor and markBody', () => {
  assert.deepEqual(R.buildBody({ artist: ' A ', title: ' T ', year: '1991', role: 'origin', note: '', sources: [] }), { artist: 'A', title: 'T', role: 'origin', year: 1991, sources: [] });
  const entry = { id: 'x', role: 'origin', note: 'n', year: 1991, sources: [{ type: 'rym', url: 'https://a.test/' }] };
  assert.deepEqual(R.patchBodyFor(entry, { year: '1991', role: 'origin', note: 'n', sources: [{ type: 'rym', url: 'https://a.test/' }] }), {});
  assert.deepEqual(R.patchBodyFor(entry, { year: '', role: 'landmark', note: '', sources: [] }), { role: 'landmark', note: '', year: null, sources: [] });
  assert.deepEqual(R.markBody({ role: 'archetype', note: ' ' }), { role: 'archetype' });
  assert.deepEqual(R.markBody({ role: 'origin', note: 'x' }), { role: 'origin', note: 'x' });
});

test('the store loads once, answers by song and refreshes after a write', async () => {
  R.resetReferences();
  let version = 0;
  const calls = stubFetch((url, opts) => {
    if (url === '/me') return { body: { owner: true } };
    if (url === '/genres/references') return { body: { references: { house: [] }, by_song: version ? { s1: [{ genre: 'house', role: 'origin' }], s2: [{ genre: 'trance', role: 'archetype' }] } : { s2: [{ genre: 'trance', role: 'archetype' }] } } };
    if (url === '/genres/house/references' && opts.method === 'POST') { version = 1; return { status: 201, body: { id: 'r1' } }; }
    return { status: 404, body: { detail: 'x' } };
  });
  await R.loadReferences();
  await R.loadReferences();
  assert.equal(calls.filter((c) => c.url === '/genres/references').length, 1);
  assert.equal(R.isReferenceOwner(), true);
  assert.deepEqual([...R.referenceSongIds()], ['s2']);
  assert.deepEqual([...R.referenceSongIds('origin')], []);
  let heard = 0;
  const off = R.onReferencesChange(() => { heard += 1; });
  await R.addReference('house', { song_id: 's1', role: 'origin' });
  off();
  assert.ok(heard >= 1);
  assert.deepEqual([...R.referenceSongIds('origin')], ['s1']);
  assert.equal(R.songMarks('s1')[0].genre, 'house');
  assert.match(R.marksTip(R.songMarks('s1')), /house \(Origin\)/);
  const post = calls.find((c) => c.opts.method === 'POST');
  assert.deepEqual(JSON.parse(post.opts.body), { song_id: 's1', role: 'origin' });
});
