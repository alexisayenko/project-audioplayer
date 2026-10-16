import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire, stubFetch } from './test-dom.mjs';

installDom();
stubFetch(() => ({ body: {} }));
const { songForm } = await import('./song-form.js');
const { initialCredits, kindFor } = await import('./song-form-credits.js');

const mk = (song = {}, mode = 'edit') => songForm({ mode, song: { id: 's1', title: 'T', tags: [], ...song } });
const fieldOf = (f, label) => f.node.querySelectorAll('.field').find((d) => d.children[0].textContent === label);
const input = (f, label) => fieldOf(f, label).querySelector('input');
const kind = (f) => f.node.querySelector('select');
const setKind = (f, k) => { kind(f).value = k; fire(kind(f), 'input'); };
const type = (el, v) => { el.value = v; fire(el, 'input'); };
const pills = (f, label) => f.node.querySelectorAll('.token-field').find((n) => n.getAttribute('aria-label') === label).querySelectorAll('.token-text').map((n) => n.textContent);
const preview = (f) => f.node.querySelector('.credits-preview');
const panel = (f) => f.node.querySelector('.credits-suggest');
const rowBtn = (f, row, text) => panel(f).querySelectorAll('.credits-suggest-row')[row].querySelectorAll('button').find((b) => b.textContent === text);
const warn = (f) => f.node.querySelector('.credits-warn');

test('the form has every credits field with its label', () => {
  const f = mk({ artists: ['A'], featured: [] });
  for (const label of ['Title', 'Artists', 'Featuring', 'Version', 'Version name', 'Remixed / mixed by', 'Version year', 'Cover of', 'First released']) {
    assert.ok(fieldOf(f, label), label);
  }
  assert.deepEqual([...kind(f).querySelectorAll('option')].map((o) => o.value), ['', 'remix', 'live', 'acoustic', 'extended', 'instrumental', 'remaster', 'edit', 'cover', 'other']);
});

test('Artists, Featuring and Remixed / mixed by are pill fields', () => {
  const f = mk({ artists: ['A', 'B'], featured: ['C'], version: { kind: 'remix', name: 'Alesso Remix', by: ['Alesso', 'X'], year: null } });
  assert.deepEqual(pills(f, 'Artists'), ['A', 'B']);
  assert.deepEqual(pills(f, 'Featuring'), ['C']);
  assert.deepEqual(pills(f, 'Remixed / mixed by'), ['Alesso', 'X']);
  assert.deepEqual(f.values().artists, ['A', 'B']);
  assert.deepEqual(f.values().version.by, ['Alesso', 'X']);
});

test('without a version the version details are hidden and values().version is null', () => {
  const f = mk({ artists: ['A'], featured: [] });
  assert.equal(fieldOf(f, 'Version name').hidden, true);
  assert.equal(fieldOf(f, 'Remixed / mixed by').parentNode.hidden, true);
  setKind(f, 'remix');
  assert.equal(fieldOf(f, 'Version name').hidden, false);
  assert.equal(fieldOf(f, 'Remixed / mixed by').parentNode.hidden, false);
  setKind(f, '');
  assert.equal(f.values().version, null);
});

test('Cover of shows only for Cover and is dropped when leaving Cover', () => {
  const f = mk({ artists: ['B'], featured: [] });
  assert.equal(fieldOf(f, 'Cover of').hidden, true);
  setKind(f, 'cover');
  assert.equal(fieldOf(f, 'Cover of').hidden, false);
  type(input(f, 'Cover of'), 'Artist A');
  assert.equal(f.values().version.of, 'Artist A');
  setKind(f, 'live');
  assert.equal(fieldOf(f, 'Cover of').hidden, true);
  assert.ok(!('of' in f.values().version));
  setKind(f, 'cover');
  assert.equal(f.values().version.of, 'Artist A', 'text is kept in the field and sent for covers');
});

test('the preview line is the display line and follows the fields', () => {
  const f = mk({ title: 'Song', artists: ['A', 'B'], featured: ['C'] });
  assert.equal(preview(f).textContent, 'A & B feat. C - Song');
  setKind(f, 'remix');
  type(input(f, 'Version name'), 'Alesso Remix');
  assert.equal(preview(f).textContent, 'A & B feat. C - Song (Alesso Remix)');
  setKind(f, 'cover');
  type(input(f, 'Version name'), '');
  assert.equal(preview(f).textContent, 'A & B feat. C - Song (cover)');
});

test('Suggested split offers the split of the current text, never applies it by itself', () => {
  const f = mk({ artists: ['Martin Garrix & Tiesto'], featured: [] });
  assert.equal(panel(f).hidden, false);
  assert.match(panel(f).textContent, /Suggested split/);
  assert.match(panel(f).textContent, /Artists: Martin Garrix \| Tiesto/);
  assert.deepEqual(f.values().artists, ['Martin Garrix & Tiesto'], 'nothing changes until Apply');
  rowBtn(f, 0, 'Apply').click();
  assert.deepEqual(f.values().artists, ['Martin Garrix', 'Tiesto']);
  assert.equal(panel(f).hidden, true, 'nothing left to suggest');
});

test('Suggested split: Dismiss hides one suggestion and keeps the text', () => {
  const f = mk({ artists: ['A, B'], featured: [] });
  assert.equal(panel(f).hidden, false);
  rowBtn(f, 0, 'Dismiss').click();
  assert.equal(panel(f).hidden, true);
  assert.deepEqual(f.values().artists, ['A, B']);
});

test('Suggested split: featuring in the artist moves to Featuring, version suggestion fills by', () => {
  const f = mk({ artists: ['Kato feat. Jon'], featured: [], version: { kind: 'remix', name: 'Alesso Remix', by: [], year: null } });
  const text = panel(f).textContent;
  assert.match(text, /Artists: Kato/);
  assert.match(text, /Featuring: Jon/);
  assert.match(text, /Version: by Alesso/);
  const rows = panel(f).querySelectorAll('.credits-suggest-row');
  assert.equal(rows.length, 3);
  for (let i = rows.length - 1; i >= 0; i -= 1) rowBtn(f, i, 'Apply').click();
  const v = f.values();
  assert.deepEqual(v.artists, ['Kato']);
  assert.deepEqual(v.featured, ['Jon']);
  assert.deepEqual(v.version.by, ['Alesso']);
  assert.equal(v.version.name, 'Alesso Remix', 'the credited text is untouched');
  assert.equal(panel(f).hidden, true);
});

test('Suggested split is recomputed from the current field text', () => {
  const f = mk({ artists: ['Solo'], featured: [] });
  assert.equal(panel(f).hidden, true);
  type(input(f, 'Version name'), 'x');
  f.setValues({ artists: ['A x B'] });
  assert.equal(panel(f).hidden, false);
  assert.match(panel(f).textContent, /Artists: A \| B/);
});

test('Suggested split: a feat. credit in the title offers to move it, title text is the only change', () => {
  const f = mk({ title: 'Song (feat. Jon)', artists: ['A'], featured: [] });
  assert.match(panel(f).textContent, /Featuring: Jon/);
  assert.match(panel(f).textContent, /Title: Song/);
  rowBtn(f, 1, 'Apply').click();
  assert.equal(f.values().title, 'Song');
});

test('warning when a Remixed / mixed by name is not in the Version name; never blocks', () => {
  const f = mk({ artists: ['A'], featured: [], version: { kind: 'remix', name: 'Alesso Remix', by: ['Alesso'], year: null } });
  assert.equal(warn(f).hidden, true);
  f.setValues({ version: { kind: 'remix', name: 'Alesso Remix', by: ['Alesso', 'Nobody'], year: null } });
  assert.equal(warn(f).hidden, false);
  assert.match(warn(f).textContent, /"Nobody"/);
  assert.ok(!/"Alesso"/.test(warn(f).textContent));
  assert.equal(f.values().version.by.length, 2, 'values are still returned');
});

test('no warning without a version name or without by names', () => {
  const f = mk({ artists: ['A'], featured: [], version: { kind: 'remix', name: null, by: ['Alesso'], year: null } });
  assert.equal(warn(f).hidden, true);
  f.setValues({ version: { kind: 'remix', name: 'Alesso Remix', by: [], year: null } });
  assert.equal(warn(f).hidden, true);
});

test('legacy songs are mapped: artist string to pills, remixer to a version, years kept', () => {
  assert.deepEqual(initialCredits({ artist: 'A - B', remixer: 'Mixed By DJ Gvozd', remix_year: 2012, year: 2000 }), { artists: ['A', 'B'], featured: [], version: { kind: 'other', name: 'Mixed By DJ Gvozd', by: [], year: 2012 }, released: 2000 });
  assert.equal(kindFor('Alesso Remix'), 'remix');
  assert.equal(kindFor('Mixed By X'), 'other');
  assert.equal(kindFor('Mixed By X Remix'), 'remix');
  assert.deepEqual(initialCredits({ artist: 'A', remix_year: 2012 }).version, { kind: 'other', name: null, by: [], year: 2012 });
  assert.equal(initialCredits({ artist: 'A' }).version, null);
});

test('First released sits beside Album and is empty when nothing gave a year', () => {
  const f = mk({ artists: ['A'], featured: [] }, 'add');
  assert.equal(input(f, 'First released').value, '');
  assert.equal(f.values().released, '');
});
