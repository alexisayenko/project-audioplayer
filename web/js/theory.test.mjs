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

const exButtons = (root) => classes(root, 'an-examples')[0].children;
const pick = (root, id) => {
  const i = anatomy.examples.findIndex((e) => e.id === id);
  fire(exButtons(root)[i], 'click');
};

test('the page shows the anatomy section with the first example and a button list of all examples', async () => {
  const root = await mount(anatomyHandler);
  assert.ok(textOf(root).includes('Composition metadata anatomy'));
  assert.equal(all(root, 'select').length, 0);
  assert.equal(root.querySelector('#an-select'), null);
  const group = classes(root, 'an-examples')[0];
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'Examples');
  const btns = [...exButtons(root)];
  assert.ok(btns.every((b) => b.tagName.toLowerCase() === 'button'));
  assert.deepEqual(btns.map(textOf), anatomy.examples.map((e) => e.rawTitle));
  assert.deepEqual(btns.map((b) => b.getAttribute('aria-pressed')), anatomy.examples.map((e, i) => (i === 0 ? 'true' : 'false')));
  assert.equal(shownTitle(root), 'Daft Punk - One More Time');
  assert.equal(all(root, 'dl').length, 1);
});

test('the table and the stored json sit in two collapsed panels', async () => {
  const root = await mount(anatomyHandler);
  const panels = all(root, 'details');
  assert.equal(panels.length, 2);
  assert.deepEqual(all(root, 'summary').map(textOf), ['Legend', 'How this song is stored']);
  for (const p of panels) assert.ok(!p.open && !p.hasAttribute('open'), 'collapsed by default');
  assert.equal(all(panels[0], 'table').length, 1);
  assert.equal(classes(panels[1], 'an-json').length, 1);
});

test('css: parts are underlined in their tone, the hint shows only for the active segment', () => {
  const css = readFileSync(new URL('../theory.css', import.meta.url), 'utf8');
  assert.match(css, /\.an-text \{[^}]*text-decoration-color: var\(--an-c\)/);
  assert.match(css, /\.an-label \{[^}]*opacity: 0[^}]*pointer-events: none/);
  assert.match(css, /\.an-label \{[^}]*position: absolute/);
  assert.match(css, /\.an-seg\.is-on \.an-label \{[^}]*opacity: 1/);
  assert.ok(!/an-mark/.test(css));
  assert.ok(!/\.an-sep[^{]*\{[^}]*underline/.test(css));
  assert.match(css, /\.an-ex\[aria-pressed="true"\] \{[^}]*var\(--selection\)/);
  assert.match(css, /\.an-examples \{[^}]*grid-template-columns: repeat\(auto-fill/);
});

test('no bracket element in the title markup', async () => {
  const root = await mount(anatomyHandler);
  assert.equal(classes(root, 'an-mark').length, 0);
  assert.ok(classes(root, 'an-label').length > 0);
});

test('clicking an example marks it pressed, unmarks the others, and keeps the opened panels open', async () => {
  const root = await mount(anatomyHandler);
  const panels = all(root, 'details');
  panels[1].open = true;
  pick(root, 'remix');
  const pressed = [...exButtons(root)].map((b) => b.getAttribute('aria-pressed'));
  assert.equal(pressed.filter((v) => v === 'true').length, 1);
  assert.equal(pressed[anatomy.examples.findIndex((e) => e.id === 'remix')], 'true');
  const after = all(root, 'details');
  assert.deepEqual(after.map((p) => p.open), [false, true]);
  assert.ok(after[0] === panels[0] && after[1] === panels[1]);
  assert.match(textOf(classes(root, 'an-json')[0]), /Pendulum/);
});

test('selecting the cover example redraws title, table and json', async () => {
  const root = await mount(anatomyHandler);
  pick(root, 'cover');
  assert.equal(shownTitle(root), 'Teemid - Crazy feat. Joie Tan (Gnarls Barkley Cover)');
  const labels = classes(root, 'an-label').map(textOf);
  assert.deepEqual(labels, ['Main artist', 'Title', 'Featured artist', 'Version, original artist']);
  assert.match(textOf(classes(root, 'an-json')[0]), /"originalArtists": \[\s*"Gnarls Barkley"/);
  const rows = classes(root, 'an-row');
  assert.ok(rows.some((r) => textOf(r).includes('version.originalArtists') && textOf(r).includes('Gnarls Barkley')));
});

test('hover and focus link a segment with its table rows, and clear on leave', async () => {
  const root = await mount(anatomyHandler);
  pick(root, 'cover');
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
