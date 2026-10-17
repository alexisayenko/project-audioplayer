import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent } from './test-dom.mjs';

installDom();
const { store } = await import('./store.js');
const { tagEditor } = await import('./tag-editor.js');

store.tags = [
  { tag: 'rock', count: 5 }, { tag: 'jazz', count: 2 }, { tag: 'genre:blues', count: 1 },
  { tag: 'decade:90s', count: 3 }, { tag: 'country:de', count: 2 }, { tag: 'lang:en', count: 9 },
];

const key = (ed, k) => { const inp = ed.node.querySelector('input'); const e = makeEvent('keydown', { key: k }); inp.dispatchEvent(e); return e; };
const typeIn = (ed, v) => { const inp = ed.node.querySelector('input'); inp.value = v; inp.dispatchEvent(makeEvent('input')); };
const chosen = (ed) => ed.node.querySelector('.chips').children.map((c) => c.getAttribute('title') || c.textContent);

test('chosen tags render; hidden lang: tags never show', () => {
  const ed = tagEditor({ tags: ['rock', 'lang:en'] });
  assert.deepEqual(ed.peek(), ['rock', 'lang:en'], 'hidden tags are kept, just not shown');
  assert.equal(ed.node.querySelector('.chips').children.length, 1);
});

test('Enter and comma add, duplicates (any case) are ignored, preventDefault is called', () => {
  const ed = tagEditor();
  typeIn(ed, 'Rock');
  assert.equal(key(ed, 'Enter').defaultPrevented, true);
  typeIn(ed, 'rock');
  key(ed, ',');
  typeIn(ed, 'pop, metal');
  key(ed, 'Enter');
  assert.deepEqual(ed.peek(), ['Rock', 'pop', 'metal']);
  assert.equal(ed.node.querySelector('input').value, '');
  assert.equal(key(ed, 'a').defaultPrevented, false);
});

test('an incomplete key: tag stays in the input instead of being added', () => {
  const ed = tagEditor();
  typeIn(ed, 'genre:');
  key(ed, 'Enter');
  assert.deepEqual(ed.peek(), []);
  assert.equal(ed.node.querySelector('input').value, 'genre:');
});

test('country tags: aliases normalise to codes, unknown names are refused with a note', () => {
  const ed = tagEditor();
  typeIn(ed, 'country:Deutschland');
  key(ed, 'Enter');
  assert.deepEqual(ed.peek(), ['country:de']);
  typeIn(ed, 'country:Atlantis');
  key(ed, 'Enter');
  assert.deepEqual(ed.peek(), ['country:de']);
  assert.equal(ed.node.querySelector('.country-note').hidden, false);
  assert.equal(ed.node.querySelector('input').value, 'country:Atlantis');
});

test('several countries can be picked via the pool', () => {
  const ed = tagEditor({ tags: ['country:fr'] });
  const chip = ed.node.querySelector('.tag-pool').querySelectorAll('button').find((b) => b.getAttribute('title') === 'country:de');
  chip.click();
  assert.deepEqual(ed.peek().filter((t) => t.startsWith('country:')), ['country:fr', 'country:de']);
});

test('picker opens for a country: prefix and selecting a country adds it', () => {
  const ed = tagEditor();
  assert.equal(ed.node.querySelector('.country-picker').hidden, true);
  typeIn(ed, 'country:ger');
  const picker = ed.node.querySelector('.country-picker');
  assert.equal(picker.hidden, false);
  const de = picker.querySelectorAll('button').find((b) => b.getAttribute('title') === 'country:de');
  assert.ok(de);
  de.click();
  assert.deepEqual(ed.peek(), ['country:de']);
  assert.equal(ed.node.querySelector('input').value, '');
});

test('pool chips toggle tags on and off and report aria-pressed', () => {
  const ed = tagEditor();
  const poolChip = () => ed.node.querySelector('.tag-pool').querySelectorAll('button').find((b) => b.getAttribute('title') === 'rock');
  poolChip().click();
  assert.deepEqual(ed.peek(), ['rock']);
  assert.equal(poolChip().getAttribute('aria-pressed'), 'true');
  poolChip().click();
  assert.deepEqual(ed.peek(), []);
});

test('the x button removes a chosen tag', () => {
  const ed = tagEditor({ tags: ['rock', 'jazz'] });
  ed.node.querySelector('.chips').querySelector('.x').click();
  assert.deepEqual(ed.peek(), ['jazz']);
});

test('onChange and subscribe receive copies on every change', () => {
  const seen = [];
  const ed = tagEditor({ onChange: (t) => seen.push(t) });
  const more = [];
  ed.subscribe((t) => more.push(t));
  ed.addTags(['x', 'lang:xx', 'x']);
  assert.deepEqual(ed.peek(), ['x']);
  assert.ok(seen.length >= 2);
  assert.deepEqual(more.at(-1), ['x']);
  more.at(-1).push('mutated');
  assert.deepEqual(ed.peek(), ['x'], 'listeners get copies');
  ed.removeTag('X');
  assert.deepEqual(ed.peek(), []);
});

test('getTags flushes text still typed in the input', () => {
  const ed = tagEditor({ tags: ['a'] });
  typeIn(ed, 'b');
  assert.deepEqual(ed.getTags(), ['a', 'b']);
});

test('decade tags are never added, suggested, listed or shown, and existing ones pass through on save', () => {
  const year = document.createElement('input');
  year.value = '1994';
  const ed = tagEditor({ tags: ['rock', 'decade:80s'], suggested: ['decade:90s', 'indie'], year });
  assert.deepEqual(ed.peek(), ['rock', 'decade:80s']);
  year.value = '2003';
  year.dispatchEvent(makeEvent('input'));
  assert.deepEqual(ed.getTags(), ['rock', 'decade:80s'], 'saved unchanged: nothing stripped, nothing added');
  assert.deepEqual(chosen(ed), ['rock']);
  const sug = ed.node.children[4];
  assert.deepEqual(sug.querySelectorAll('button').map((b) => b.getAttribute('title')), ['indie']);
  const pool = ed.node.querySelector('.tag-pool').querySelectorAll('button').map((b) => b.getAttribute('title'));
  assert.ok(pool.includes('rock') && !pool.some((t) => t.startsWith('decade:')));
  typeIn(ed, 'the 90s');
  assert.equal(ed.node.querySelector('.tag-pool').querySelectorAll('button').length, 0);
  ed.addTags(['decade:70s']);
  key(ed, 'Enter');
  assert.ok(!ed.peek().includes('decade:70s'));
});

test('suggested tags show once, can be toggled on, and hideNs hides genre:/country: ones', () => {
  const ed = tagEditor({ suggested: ['indie', 'genre:folk'], hideNs: true });
  const sug = ed.node.children[4];
  assert.equal(sug.querySelectorAll('button').length, 1);
  ed.setSuggested(['indie', 'new']);
  assert.equal(ed.node.children[4].querySelectorAll('button').length, 2);
  ed.setSuggested(['genre:rock'], { all: true });
  assert.equal(ed.node.children[4].querySelectorAll('button').length, 3);
});

test('search narrows the pool', () => {
  const ed = tagEditor();
  typeIn(ed, 'jaz');
  const titles = ed.node.querySelector('.tag-pool').querySelectorAll('button').map((b) => b.getAttribute('title'));
  assert.deepEqual(titles, ['jazz']);
});

test('searching must not surface hidden lang: tags in the pool', () => {
  const ed = tagEditor();
  typeIn(ed, 'en');
  const titles = ed.node.querySelector('.tag-pool').querySelectorAll('button').map((b) => b.getAttribute('title'));
  assert.ok(!titles.includes('lang:en'));
});
