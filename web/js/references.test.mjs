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

test('eras: years, sorting and grouping', () => {
  assert.equal(R.eraYears({ start: 1994, end: 1997 }), 'c. 1994-1997');
  assert.equal(R.eraYears({ start: 2000, end: null }), 'since 2000');
  assert.equal(R.eraYears({ name: 'x' }), '');
  const eras = [{ id: 'b', name: 'Late', start: 2000 }, { id: 'a', name: 'Early', start: 1987, end: 1992 }, { id: 'c', name: 'Empty', start: 2010 }];
  const entries = [
    { id: '1', title: 'Z', year: 2001, era: 'b' }, { id: '2', title: 'B', year: 1989, era: 'a' }, { id: '3', title: 'A', year: 1989, era: 'a' },
    { id: '4', title: 'Q', year: 1999, era: null }, { id: '5', title: 'R', year: 1990, era: 'gone' },
  ];
  const owner = R.groupByEra(entries, eras, { owner: true });
  assert.deepEqual(owner.map((g) => g.era?.id || null), ['a', 'b', 'c', null]);
  assert.deepEqual(owner[0].entries.map((e) => e.id), ['3', '2']);
  assert.deepEqual(owner[3].entries.map((e) => e.id), ['5', '4']);
  assert.deepEqual(R.groupByEra(entries, eras).map((g) => g.era?.id || null), ['a', 'b', null]);
  const flat = R.groupByEra(entries, []);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].era, null);
});

test('eras editor payload: ids kept, years validated, empty rows dropped', () => {
  const ok = R.cleanEras([
    { id: 'a', name: ' Early ', start: '1987', end: '1992', note: ' n ', sources: [{ type: 'wikipedia', url: 'https://w.test/x', note: '' }] },
    { name: 'Late', start: '2000', end: '', note: '', sources: [] },
    { name: '', start: '', end: '', note: '', sources: [{ url: '' }] },
  ]);
  assert.equal(ok.error, '');
  assert.deepEqual(ok.eras, [
    { id: 'a', name: 'Early', start: 1987, end: 1992, note: 'n', sources: [{ type: 'wikipedia', url: 'https://w.test/x' }] },
    { name: 'Late', start: 2000, end: null, sources: [] },
  ]);
  assert.match(R.cleanEras([{ name: '', start: '1990' }]).error, /needs a name/);
  assert.match(R.cleanEras([{ name: 'A', start: '99' }]).error, /four digits/);
  assert.match(R.cleanEras([{ name: 'A', start: '2000', end: '1990' }]).error, /ends before/);
  assert.match(R.cleanEras([{ name: 'A' }, { name: 'a' }]).error, /different/);
});

test('era in the entry bodies', () => {
  assert.equal(R.buildBody({ artist: 'a', title: 't', role: 'origin', era: 'e1' }).era, 'e1');
  assert.equal('era' in R.buildBody({ artist: 'a', title: 't', role: 'origin', era: '' }), false);
  const entry = { role: 'origin', era: 'e1', sources: [] };
  assert.deepEqual(R.patchBodyFor(entry, { role: 'origin', era: '', sources: [] }), { era: null });
  assert.deepEqual(R.patchBodyFor(entry, { role: 'origin', era: 'e1', sources: [] }), {});
  assert.deepEqual(R.patchBodyFor({ role: 'origin', sources: [] }, { role: 'origin', era: 'e2', sources: [] }), { era: 'e2' });
  assert.deepEqual(R.markBody({ role: 'origin', era: 'e1' }), { role: 'origin', era: 'e1' });
});
