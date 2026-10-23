import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
let owner = false;
let entries = [];
let erasData = [];
const calls = stubFetch((url, opts) => {
  if (url === '/me') return { body: { owner } };
  if (url === '/genres/references') return { body: { references: {}, by_song: {} } };
  if (url.startsWith('/genres/') && url.endsWith('/references') && (opts.method || 'GET') === 'GET') return { body: { genre: 'house', references: entries, eras: erasData } };
  return { body: {} };
});
const R = await import('./references.js');
const { createReferencesPanel, EMPTY_REFERENCES, NOT_IN_LIBRARY, linkText, eraSpan, eraNoteText } = await import('./genre-references.js');

const text = (n) => n.textContent;
const find = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const c of n.children || []) find(c, pred, out); return out; };
const byClass = (n, cls) => find(n, (x) => (x.className || '').split(' ').includes(cls));

const lib = { id: 'e1', artist: 'Frankie Knuckles', title: 'Your Love', year: 1987, role: 'origin', note: 'First deep house hit', reviewed: true, in_library: true, song_id: 's1', song: { id: 's1', title: 'Your Love', artist: 'Frankie Knuckles' }, sources: [{ type: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Your_Love' }, { type: 'rym', url: 'https://rateyourmusic.com/x' }], source_count: 2 };
const wish = { id: 'e2', artist: 'Marshall Jefferson', title: 'Move Your Body', role: 'archetype', reviewed: false, in_library: false, sources: [{ type: 'chart', url: 'https://charts.test/1' }, { type: 'other', url: 'https://www.youtube.com/watch?v=abc' }], source_count: 2 };
const bare = { id: 'e3', artist: 'X', title: 'Y', role: 'landmark', reviewed: true, in_library: false, sources: [], source_count: 0 };

async function shown(list, isOwner) {
  R.resetReferences();
  owner = isOwner;
  entries = list;
  erasData = [];
  const p = createReferencesPanel();
  p.show('house');
  for (let i = 0; i < 4; i += 1) await flush();
  return p;
}

test('empty state', async () => {
  const p = await shown([], false);
  assert.equal(p.node.hidden, false);
  assert.match(text(p.node), new RegExp(EMPTY_REFERENCES));
  assert.equal(byClass(p.node, 'ref-add-btn').length, 0);
});

test('entries: role badge, line, note, play, add to library, marks, read-only for non-owners', async () => {
  const p = await shown([lib, wish, bare], false);
  const items = byClass(p.node, 'ref-item');
  assert.equal(items.length, 3);
  assert.match(text(items[0]), /Origin/);
  assert.match(text(items[0]), /Your Love/);
  assert.equal(text(byClass(items[0], 'ref-sub')[0]), 'Frankie Knuckles · 1987');
  assert.equal(byClass(items[0], 'ref-cover').length, 1);
  assert.match(text(items[0]), /First deep house hit/);
  assert.equal(byClass(items[0], 'ref-play').length, 1);
  assert.equal(byClass(items[0], 'ref-todo').length, 0);
  const srcs = byClass(items[0], 'ref-src');
  assert.equal(srcs.length, 2);
  assert.equal(srcs[0].getAttribute('href'), 'https://en.wikipedia.org/wiki/Your_Love');
  assert.equal(srcs[0].getAttribute('target'), '_blank');
  assert.match(srcs[0].getAttribute('rel'), /noopener/);
  assert.match(srcs[0].title, /^Wikipedia:/);
  assert.equal(byClass(items[1], 'ref-add-lib').length, 1);
  assert.doesNotMatch(text(items[1]), /To review/);
  assert.equal(byClass(items[2], 'ref-add-lib').length, 0);
  assert.match(text(items[2]), new RegExp(NOT_IN_LIBRARY));
  assert.equal(byClass(items[2], 'ref-src').length, 0);
  assert.equal(byClass(p.node, 'ref-owner').length, 0);
});

test('the owner sees no editing controls', async () => {
  const p = await shown([wish], true);
  for (const c of ['ref-edit', 'ref-del', 'ref-review', 'ref-add-btn', 'ref-eras-btn', 'ref-owner']) assert.equal(byClass(p.node, c).length, 0);
  assert.doesNotMatch(text(p.node), /Add a track|Edit eras/);
  assert.doesNotMatch(text(p.node), /To review/);
  assert.equal(byClass(p.node, 'ref-item').length, 1);
});

test('hidden without a genre', async () => {
  const p = await shown([lib], false);
  p.show(null);
  assert.equal(p.node.hidden, true);
});

test('linkText shortens a link', () => {
  assert.equal(linkText('https://www.example.com/a/b'), 'example.com/a/b');
  assert.ok(linkText(`https://a.test/${'x'.repeat(80)}`).length <= 48);
});

const eraList = [
  { id: 'e-late', name: 'Revival', start: 2000, end: null, note: 'Back again', sources: [] },
  { id: 'e-early', name: 'Chicago', start: 1986, end: 1990, sources: [{ type: 'wikipedia', url: 'https://w.test/c' }] },
  { id: 'e-none', name: 'Unused', start: 1995, end: 1996, sources: [] },
];

async function shownWithEras(list, isOwner) {
  R.resetReferences();
  owner = isOwner;
  entries = list;
  erasData = eraList;
  const p = createReferencesPanel();
  p.show('house');
  for (let i = 0; i < 4; i += 1) await flush();
  return p;
}

test('eras form a timeline, tracks a flat list after it', async () => {
  const a = { ...lib, era: 'e-early' };
  const b = { ...wish, id: 'e9', year: 2003, era: 'e-late' };
  const p = await shownWithEras([b, a, bare], false);
  const phases = byClass(p.node, 'ref-phase');
  assert.deepEqual(phases.map((x) => text(byClass(x, 'ref-era-name')[0])), ['Chicago', 'Unused', 'Revival']);
  assert.deepEqual(phases.map((x) => text(byClass(x, 'ref-era-years')[0])), ['1986-90', '1995-96', '2000-']);
  assert.equal(byClass(phases[0], 'ref-node').length, 1);
  assert.equal(byClass(phases[0], 'ref-era-note').length, 0);
  assert.equal(text(byClass(phases[2], 'ref-era-note')[0]), 'Back again');
  assert.equal(byClass(phases[2], 'ref-cite').length, 0);
  assert.equal(byClass(p.node, 'ref-rule').length, 2);
  assert.equal(byClass(p.node, 'ref-item').length, 3);
  assert.equal(byClass(p.node, 'ref-era').length, 0);
  const order = p.node.children.map((c) => c.className.split(' ')[0]);
  assert.deepEqual(order, ['ref-rule', 'ref-timeline', 'ref-rule', 'ref-head', 'ref-list']);
});

test('era sources are numbered links that open in a new tab', async () => {
  R.resetReferences();
  entries = [lib];
  erasData = [{ id: 'x', name: 'Chicago', start: 1986, end: 1990, sources: [{ type: 'wikipedia', url: 'https://w.test/c' }, { type: 'rym', url: 'https://r.test/c' }] }];
  const p = createReferencesPanel();
  p.show('house');
  for (let i = 0; i < 4; i += 1) await flush();
  const cites = byClass(p.node, 'ref-cite');
  assert.deepEqual(cites.map(text), ['[1]', '[2]']);
  assert.deepEqual(cites.map((c) => c.getAttribute('href')), ['https://w.test/c', 'https://r.test/c']);
  for (const c of cites) { assert.equal(c.getAttribute('target'), '_blank'); assert.match(c.getAttribute('rel'), /noopener/); }
});

test('only eras: no tracks heading; only tracks: no timeline', async () => {
  const onlyEras = await shownWithEras([], false);
  assert.equal(byClass(onlyEras.node, 'ref-timeline').length, 1);
  assert.equal(byClass(onlyEras.node, 'ref-head').length, 0);
  assert.equal(byClass(onlyEras.node, 'ref-rule').length, 2);
  const onlyTracks = await shown([lib], false);
  assert.equal(byClass(onlyTracks.node, 'ref-timeline').length, 0);
  assert.equal(byClass(onlyTracks.node, 'ref-rule').length, 1);
  assert.equal(byClass(onlyTracks.node, 'ref-head').length, 1);
});

test('eraSpan shortens the end year', () => {
  assert.equal(eraSpan({ start: 1990, end: 1993 }), '1990-93');
  assert.equal(eraSpan({ start: 1998, end: 2003 }), '1998-2003');
  assert.equal(eraSpan({ start: 1990, end: 1990 }), '1990');
  assert.equal(eraSpan({}), '');
});

test('the owner sees no empty eras and no era tools', async () => {
  const p = await shownWithEras([{ ...lib, era: 'e-early' }], true);
  assert.match(text(p.node), /Unused/);
  assert.doesNotMatch(text(p.node), /No tracks yet./);
  assert.equal(byClass(p.node, 'ref-eras-btn').length, 0);
  assert.equal(find(p.node, (x) => x.tagName === 'FORM').length, 0);
});

test('play button mirrors playback: pause when current and playing, resume on click, live updates, no leaks', async () => {
  const { player } = await import('./player.js');
  const subs = new Set();
  let cur = null;
  let isPlaying = false;
  const calls2 = [];
  const saved = ['currentId', 'playing', 'onChange', 'toggle', 'playNow'].map((k) => [k, Object.getOwnPropertyDescriptor(player, k)]);
  Object.defineProperty(player, 'currentId', { get: () => cur, configurable: true });
  Object.defineProperty(player, 'playing', { get: () => isPlaying, configurable: true });
  Object.defineProperty(player, 'onChange', { value: (fn) => { subs.add(fn); return () => subs.delete(fn); }, configurable: true });
  Object.defineProperty(player, 'toggle', { value: () => calls2.push('toggle'), configurable: true });
  Object.defineProperty(player, 'playNow', { value: (id) => calls2.push(`now:${id}`), configurable: true });
  try {
    const p = await shown([lib, wish], false);
    const btn = () => byClass(p.node, 'ref-play')[0];
    assert.equal(btn().getAttribute('aria-label'), 'Play Frankie Knuckles - Your Love (1987)');
    assert.equal(btn().title, 'Play');
    btn().click();
    assert.deepEqual(calls2, ['now:s1']);
    cur = 's1'; isPlaying = true;
    subs.forEach((f) => f());
    assert.equal(btn().title, 'Pause');
    assert.match(btn().getAttribute('aria-label'), /^Pause /);
    btn().click();
    assert.equal(calls2.at(-1), 'toggle');
    isPlaying = false;
    subs.forEach((f) => f());
    assert.equal(btn().title, 'Play');
    btn().click();
    assert.equal(calls2.at(-1), 'toggle');
    cur = 'other'; isPlaying = true;
    subs.forEach((f) => f());
    assert.equal(btn().title, 'Play');
    cur = 's1';
    p.show('house');
    for (let i = 0; i < 4; i += 1) await flush();
    assert.equal(btn().title, 'Pause');
    assert.equal(subs.size, 1);
    p.show(null);
    assert.equal(subs.size, 0);
    p.show('house');
    for (let i = 0; i < 4; i += 1) await flush();
    p.destroy();
    assert.equal(subs.size, 0);
  } finally {
    for (const [k, d] of saved) { if (d) Object.defineProperty(player, k, d); else delete player[k]; }
  }
});

test('eraNoteText strips a leading date that repeats the years label', () => {
  assert.equal(eraNoteText('c. 1983-1991. New beat and EBM.'), 'New beat and EBM.');
  assert.equal(eraNoteText('1991-1993. The first records.'), 'The first records.');
  assert.equal(eraNoteText('c. 1991-93 — first records'), 'First records');
  assert.equal(eraNoteText('From 1994 to 1997: London labels.'), 'London labels.');
  assert.equal(eraNoteText('c. 1998-early 2000s. Sound turns metallic.'), 'Sound turns metallic.');
  assert.equal(eraNoteText('c. 2000s onward. Revival.'), 'Revival.');
});

test('eraNoteText keeps notes without a date prefix and drops date-only notes', () => {
  assert.equal(eraNoteText('New beat from 1983-1991.'), 'New beat from 1983-1991.');
  assert.equal(eraNoteText('  Plain note  '), 'Plain note');
  assert.equal(eraNoteText('c. 1983-1991.'), '');
  assert.equal(eraNoteText(''), '');
  assert.equal(eraNoteText(null), '');
});

test('a library track caption is a button that opens the song card; others stay plain text', async () => {
  const { store } = await import('./store.js');
  store.set?.([{ id: 's1', title: 'Your Love', artist: 'Frankie Knuckles', tags: [], genres: [] }]);
  const p = await shown([lib, wish, bare], false);
  const items = byClass(p.node, 'ref-item');
  const btn = byClass(items[0], 'ref-title')[0];
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.type, 'button');
  assert.equal(byClass(items[0], 'ref-play').length, 1);
  for (const i of [1, 2]) assert.notEqual(byClass(items[i], 'ref-title')[0].tagName, 'BUTTON');
  const card = document.getElementById('song-card');
  btn.click();
  for (let i = 0; i < 4; i += 1) await flush();
  assert.equal(card.open, true);
  card.close();
});
