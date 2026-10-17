import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
const { renderTheory, sortTerms, FAIL_TEXT, EMPTY_TEXT } = await import('./theory.js');
const file = JSON.parse(readFileSync(new URL('../data/theory-terms.json', import.meta.url), 'utf8'));

const textOf = (n) => (n.textContent ?? '');
const all = (n, tag, out = []) => {
  for (const c of n.children ?? []) { if (c.tagName?.toLowerCase() === tag) out.push(c); all(c, tag, out); }
  return out;
};
const mount = async (handler) => {
  stubFetch(handler);
  const root = document.createElement('div');
  renderTheory(root);
  await flush();
  await flush();
  return root;
};

test('data file: unique ids, alphabetical sort, exactly the three terms', () => {
  const ids = file.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(sortTerms([...file]).map((t) => t.id), ['british-invasion', 'drum-machine', 'syncopation']);
  for (const t of file) assert.ok(t.term && t.description);
});

test('renders the heading and the terms from the json in alphabetical order', async () => {
  const root = await mount(() => ({ body: [file[2], file[0], file[1]] }));
  assert.equal(textOf(all(root, 'h1')[0]), 'Music theory');
  assert.equal(all(root, 'dl').length, 1);
  assert.deepEqual(all(root, 'dt').map(textOf), ['British Invasion', 'Drum machine', 'Syncopation']);
  assert.equal(all(root, 'dd').length, 3);
  assert.match(textOf(all(root, 'dd')[2]), /off-beats/);
});

test('shows a message when the load fails', async () => {
  const root = await mount(() => ({ status: 500, body: {} }));
  assert.ok(textOf(root).includes(FAIL_TEXT));
  assert.equal(all(root, 'dl').length, 0);
});

test('shows a message when the list is empty', async () => {
  const root = await mount(() => ({ body: [] }));
  assert.ok(textOf(root).includes(EMPTY_TEXT));
});

const anatomy = JSON.parse(readFileSync(new URL('../data/theory-anatomy.json', import.meta.url), 'utf8'));
const { renderAnatomy, rowsFor, pathValue, formatValue, loadAnatomy, ANATOMY_FAIL_TEXT } = await import('./theory.js');
const { fire } = await import('./test-dom.mjs');
const shownTitle = (root) => classes(root, 'an-title')[0].children.map((c) => (c.classList.contains('an-seg') ? textOf(c.children[0]) : textOf(c))).join('');
const anatomyHandler = (url) => ({ body: String(url).includes('anatomy') ? anatomy : file });
const classes = (n, cls, out = []) => {
  for (const c of n.children ?? []) { if (c.classList?.contains(cls)) out.push(c); classes(c, cls, out); }
  return out;
};

test('anatomy data: every example lists the expected types and its segments rebuild the raw title', () => {
  const ids = new Set(anatomy.fields.map((f) => f.id));
  assert.equal(ids.size, anatomy.fields.length);
  assert.deepEqual(anatomy.examples.map((e) => e.id),
    ['plain', 'feat', 'remix', 'cover', 'mashup', 'live', 'acoustic', 'extended', 'instrumental', 'remaster', 'edit']);
  for (const e of anatomy.examples) {
    assert.equal(e.segments.map((s) => s.text).join(''), e.rawTitle, e.id);
    assert.equal(e.song.rawTitle, e.rawTitle);
    for (const s of e.segments) for (const f of s.fields ?? []) assert.ok(ids.has(f), `${e.id}: ${f}`);
    if (e.song.version) assert.equal(e.song.version.type, e.id === 'plain' ? undefined : e.id);
  }
});

test('anatomy data follows the version rules: remixer in artists, cover and mashup originals', () => {
  const by = Object.fromEntries(anatomy.examples.map((e) => [e.id, e.song]));
  assert.deepEqual(by.remix.version.artists, ['Pendulum']);
  assert.deepEqual(by.remix.mainArtists, ['The Prodigy']);
  assert.deepEqual(by.cover.mainArtists, ['Teemid']);
  assert.deepEqual(by.cover.version.originalArtists, ['Gnarls Barkley']);
  assert.deepEqual(by.cover.featuredArtists, ['Joie Tan']);
  assert.ok(by.mashup.version.originalArtists.length > 1);
  assert.equal(by.live.version.originalArtists, undefined);
  assert.equal(by.plain.version, undefined);
});

test('helpers: pathValue, formatValue, rowsFor', () => {
  assert.equal(pathValue({ a: { b: 3 } }, 'a.b'), 3);
  assert.equal(pathValue({}, 'a.b'), undefined);
  assert.equal(formatValue([]), 'none');
  assert.equal(formatValue(['A', 'B']), 'A, B');
  assert.equal(formatValue({ platform: 'youtube', url: 'u' }), 'youtube u');
  assert.equal(formatValue(null), 'none');
  assert.equal(formatValue(2000), '2000');
  const plain = rowsFor(anatomy.examples[0], anatomy.fields).map((r) => r.id);
  assert.ok(!plain.some((id) => id.startsWith('version.')));
  const cover = rowsFor(anatomy.examples[3], anatomy.fields).map((r) => r.id);
  assert.ok(cover.includes('version.originalArtists') && cover.includes('version.artists'));
});

test('the page shows the anatomy section with the first example and a select of all examples', async () => {
  const root = await mount(anatomyHandler);
  assert.ok(textOf(root).includes('Composition metadata anatomy'));
  const sel = all(root, 'select')[0];
  assert.equal(all(sel, 'option').length, anatomy.examples.length);
  assert.deepEqual(all(sel, 'option').map(textOf), anatomy.examples.map((e) => e.rawTitle));
  assert.equal(shownTitle(root), 'Daft Punk - One More Time');
  assert.equal(all(root, 'dl').length, 1);
});

test('selecting the cover example redraws title, table and json', async () => {
  const root = await mount(anatomyHandler);
  const sel = all(root, 'select')[0];
  sel.value = 'cover';
  fire(sel, 'change');
  assert.equal(shownTitle(root), 'Teemid - Crazy feat. Joie Tan (Gnarls Barkley Cover)');
  const labels = classes(root, 'an-label').map(textOf);
  assert.deepEqual(labels, ['Main artist', 'Title', 'Featured artist', 'Version, original artist']);
  assert.match(textOf(classes(root, 'an-json')[0]), /"originalArtists": \[\s*"Gnarls Barkley"/);
  const rows = classes(root, 'an-row');
  assert.ok(rows.some((r) => textOf(r).includes('version.originalArtists') && textOf(r).includes('Gnarls Barkley')));
  sel.value = 'nope';
  fire(sel, 'change');
  assert.equal(classes(root, 'an-row').length, rows.length);
});

test('hover and focus link a segment with its table rows, and clear on leave', async () => {
  const root = await mount(anatomyHandler);
  const sel = all(root, 'select')[0];
  sel.value = 'cover';
  fire(sel, 'change');
  const segs = classes(root, 'an-seg');
  const rows = classes(root, 'an-row');
  const on = () => rows.filter((r) => r.classList.contains('is-on')).map((r) => textOf(r.children[0]).split(/(?=[A-Z])/)[0]);
  segs[3].dispatchEvent(new Event('mouseenter'));
  assert.ok(segs[3].classList.contains('is-on'));
  assert.equal(rows.filter((r) => r.classList.contains('is-on')).length, 3);
  segs[3].dispatchEvent(new Event('mouseleave'));
  assert.equal(rows.filter((r) => r.classList.contains('is-on')).length, 0);
  const mainRow = rows.find((r) => textOf(r.children[0]).startsWith('mainArtists'));
  mainRow.dispatchEvent(new Event('focus'));
  assert.ok(segs[0].classList.contains('is-on'));
  assert.ok(!segs[1].classList.contains('is-on'));
  assert.ok(mainRow.classList.contains('is-on'));
  mainRow.dispatchEvent(new Event('blur'));
  assert.ok(!segs[0].classList.contains('is-on'));
  assert.equal(on().length, 0);
});

test('segments and rows are keyboard focusable', async () => {
  const root = await mount(anatomyHandler);
  for (const n of [...classes(root, 'an-seg'), ...classes(root, 'an-row')]) assert.equal(n.getAttribute('tabindex'), '0');
});

test('anatomy load failure shows a message and keeps the terms', async () => {
  const root = await mount((url) => (String(url).includes('anatomy') ? { status: 500, body: {} } : { body: file }));
  assert.ok(textOf(root).includes(ANATOMY_FAIL_TEXT));
  assert.equal(all(root, 'dt').length, 3);
});

test('loadAnatomy rejects malformed data', async () => {
  await assert.rejects(loadAnatomy(async () => ({ ok: true, json: async () => ({ fields: [] }) })));
  await assert.rejects(loadAnatomy(async () => ({ ok: false, status: 404 })));
  const ok = await loadAnatomy(async () => ({ ok: true, json: async () => anatomy }));
  assert.equal(ok.examples.length, 11);
});

test('an empty example list shows the failure message', async () => {
  const root = await mount((url) => ({ body: String(url).includes('anatomy') ? { fields: [], examples: [] } : file }));
  assert.ok(textOf(root).includes(ANATOMY_FAIL_TEXT));
  assert.ok(renderAnatomy({ fields: [], examples: [] }));
});
