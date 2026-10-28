import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, stubFetch } from './test-dom.mjs';

installDom();
stubFetch(() => ({ body: {} }));
const { labelField } = await import('./label-field.js');
const { store } = await import('./store.js');
const { noteAlbums } = await import('./label-suggest.js');

function make(opts = {}) {
  const f = labelField(opts);
  document.body.append(f.node);
  const type = (v, extra = {}) => { f.input.value = v; f.input.dispatchEvent(makeEvent('input', extra)); };
  const key = (k) => { const e = makeEvent('keydown', { key: k }); f.input.dispatchEvent(e); return e; };
  const pills = () => f.node.querySelector('.chips').children.map((c) => c.getAttribute('title'));
  const options = () => f.node.querySelectorAll('option').map((o) => o.value);
  return { f, type, key, pills, options };
}

test('the initial labels are pills, cleaned, with a remove button each', () => {
  const { f, pills } = make({ initial: ['  Blue   Room Released ', 'blue room released', 'Phonokol'] });
  assert.deepEqual(pills(), ['Blue Room Released', 'Phonokol']);
  assert.deepEqual(f.get(), ['Blue Room Released', 'Phonokol']);
  assert.equal(f.node.querySelectorAll('.x').length, 2);
});

test('Enter commits the typed label as a pill and clears the input', () => {
  const { f, type, key, pills } = make();
  type('Parvati Records');
  assert.equal(key('Enter').defaultPrevented, true);
  assert.deepEqual(pills(), ['Parvati Records']);
  assert.equal(f.input.value, '');
  assert.deepEqual(f.get(), ['Parvati Records']);
});

test('a comma finishes a label and a slash stays part of the name', () => {
  const { f, type, pills } = make();
  type('Iono Music, Phono/Kol');
  assert.deepEqual(pills(), ['Iono Music']);
  assert.equal(f.input.value, 'Phono/Kol');
  f.commit();
  assert.deepEqual(f.get(), ['Iono Music', 'Phono/Kol']);
});

test('blur commits a half-typed label and an empty blur does nothing', () => {
  const { f, type } = make();
  type('Armada');
  f.input.dispatchEvent(makeEvent('blur'));
  assert.deepEqual(f.get(), ['Armada']);
  f.input.dispatchEvent(makeEvent('blur'));
  assert.deepEqual(f.get(), ['Armada']);
});

test('the x removes a pill and Backspace on an empty input removes the last one', () => {
  const { f, key, pills } = make({ initial: ['A', 'B', 'C'] });
  f.node.querySelectorAll('.x')[0].click();
  assert.deepEqual(pills(), ['B', 'C']);
  key('Backspace');
  assert.deepEqual(pills(), ['B']);
  f.input.value = 'x';
  key('Backspace');
  assert.deepEqual(pills(), ['B'], 'Backspace edits the text first');
});

test('a duplicate in another case is not added twice', () => {
  const { f, type, key } = make({ initial: ['Parvati Records'] });
  type('parvati records');
  key('Enter');
  assert.deepEqual(f.get(), ['Parvati Records']);
});

test('the field holds at most ten labels and says so', () => {
  const { f, type, key } = make({ initial: Array.from({ length: 10 }, (_, i) => `L${i}`) });
  type('One more');
  key('Enter');
  assert.equal(f.get().length, 10);
  assert.match(f.node.textContent, /up to 10 labels/);
});

test('the suggestions come from the library and leave out labels already chosen', () => {
  store.songs = [{ id: 'a', labels: ['Parvati Records', 'Iono Music'] }, { id: 'b', labels: ['Parvati Records'] }];
  noteAlbums([{ labels: ['Phonokol'] }]);
  const { f, options } = make({ initial: ['Iono Music'] });
  assert.deepEqual(options(), ['Parvati Records', 'Phonokol']);
  assert.equal(f.input.getAttribute('list'), f.node.querySelector('datalist').id);
  f.set(['Parvati Records']);
  assert.deepEqual(options(), ['Iono Music', 'Phonokol']);
  store.songs = [];
  noteAlbums(null);
});

test('picking a suggestion from the list adds it at once, typing the same text does not', () => {
  store.songs = [{ id: 'a', labels: ['Armada Music'] }];
  const { f, type } = make();
  type('Armada Music', { inputType: 'insertText' });
  assert.deepEqual(f.get(), [], 'still typing');
  type('Armada Music', { inputType: 'insertReplacementText' });
  assert.deepEqual(f.get(), ['Armada Music']);
  assert.equal(f.input.value, '');
  store.songs = [];
});

test('subscribers hear about changes, set replaces the labels and add keeps them', () => {
  const { f } = make({ initial: ['A'] });
  let n = 0;
  const off = f.subscribe(() => { n += 1; });
  f.add(['B']);
  assert.deepEqual(f.get(), ['A', 'B']);
  f.set(['C']);
  assert.deepEqual(f.get(), ['C']);
  f.add(['c']);
  assert.equal(n, 2, 'nothing new was added');
  off();
  f.set([]);
  assert.equal(n, 2);
  assert.equal(f.node.querySelector('.chips').hidden, true);
});
