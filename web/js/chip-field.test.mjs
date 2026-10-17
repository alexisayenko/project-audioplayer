import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, stubFetch, flush } from './test-dom.mjs';

installDom();
const VOCAB = {
  families: [],
  genres: [
    ['rock', 'Rock', 'genre'], ['jazz', 'Jazz', 'genre'], ['blues', 'Blues', 'genre'], ['hip hop', 'Hip Hop', 'genre'], ['funk', 'Funk / Soul', 'style'], ['soul', 'Funk / Soul', 'style'],
    ['punk', 'Rock', 'style'], ['ska', 'Reggae', 'style'], ['trance', 'Electronic', 'style'], ['rap', 'Hip Hop', 'style'], ['drum and bass', 'Electronic', 'style'], ['house', 'Electronic', 'style'],
    ['rhythm & blues', 'Funk / Soul', 'style'],
  ].map(([name, family, level]) => ({ name, family, level, parent: null, extra: false, also_under: [] })),
  aliases: { dnb: 'drum and bass', indie: 'rock' },
};
stubFetch((url) => (url === '/genres/vocabulary' ? { body: VOCAB } : { body: {} }));
const { tagEditor } = await import('./tag-editor.js');
const { chipField } = await import('./chip-field.js');
const { store } = await import('./store.js');
const { loadVocabulary, resetVocabulary } = await import('./genre-vocab.js');
await loadVocabulary();

function make(ns, tags = []) {
  const editor = tagEditor({ tags, hideNs: true });
  const f = chipField(ns, editor);
  document.body.append(f.node);
  const input = f.node.querySelector('input');
  const type = (v) => { input.value = v; input.dispatchEvent(makeEvent('input')); };
  const key = (k) => { const e = makeEvent('keydown', { key: k }); input.dispatchEvent(e); return e; };
  const chips = () => f.node.querySelector('.chips').children.map((c) => c.getAttribute('title'));
  return { editor, f, input, type, key, chips };
}

test('existing genre tags render as chips; the x removes one', () => {
  const { editor, f } = make('genre', ['genre:rock', 'country:de', 'indie']);
  assert.equal(f.node.querySelector('.chips').children.length, 1);
  f.node.querySelector('.chips').querySelector('.x').click();
  assert.deepEqual(editor.peek(), ['country:de', 'indie']);
  assert.equal(f.node.querySelector('.chips').hidden, true);
});

test('Enter, comma and slash commit typed genres lower-cased with the namespace', () => {
  const { editor, type, key, input } = make('genre');
  type('Hip Hop');
  assert.equal(key('Enter').defaultPrevented, true);
  assert.deepEqual(editor.peek(), ['genre:hip hop']);
  assert.equal(input.value, '');
  type('Funk');
  key(',');
  type('Soul');
  key('/');
  assert.deepEqual(editor.peek(), ['genre:hip hop', 'genre:funk', 'genre:soul']);
});

test('typing a separator flushes finished chips and keeps the remainder', () => {
  const { editor, type, input } = make('genre');
  type('punk, ska');
  assert.deepEqual(editor.peek(), ['genre:punk']);
  assert.equal(input.value, 'ska');
});

test('genre cap of 12 flags extra genres invalid instead of adding', () => {
  const tags = Array.from({ length: 12 }, (_, i) => `genre:g${i}`);
  const { editor, type, key, input } = make('genre', tags);
  type('extra');
  key('Enter');
  assert.equal(editor.peek().length, 12);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(input.value, 'extra', 'rejected text stays for correction');
});

test('blur commits what was typed', () => {
  const { editor, type, input } = make('genre');
  type('trance');
  input.dispatchEvent(makeEvent('blur'));
  assert.deepEqual(editor.peek(), ['genre:trance']);
});

test('suggestions appear from the genre list, arrow keys + Enter pick one, Escape closes', async () => {
  const { editor, type, key, input, f } = make('genre');
  input.focus();
  type('r');
  await flush();
  const list = f.node.querySelector('[role=listbox]');
  assert.notEqual(list.style.display, 'none');
  assert.ok(list.children.length >= 1);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  key('ArrowDown');
  assert.equal(list.children[0].getAttribute('aria-selected'), 'true');
  assert.ok(input.getAttribute('aria-activedescendant'));
  key('ArrowUp');
  key('ArrowDown');
  const first = list.children[0].getAttribute('data-genre');
  key('Enter');
  assert.deepEqual(editor.peek(), [`genre:${first}`]);
  assert.equal(list.style.display, 'none');
  type('j');
  assert.equal(key('Escape').defaultPrevented, true);
  assert.equal(list.style.display, 'none');
});

test('clicking a suggestion adds it', async () => {
  const { editor, type, input, f } = make('genre');
  input.focus();
  type('ja');
  await flush();
  f.node.querySelector('[role=listbox]').children[0].click();
  assert.deepEqual(editor.peek(), ['genre:jazz']);
});

test('country: names and ISO codes resolve, unknown input is flagged, several countries', () => {
  const { editor, type, key, input } = make('country');
  type('Italy');
  key('Enter');
  assert.deepEqual(editor.peek(), ['country:it']);
  type('fr');
  key('Enter');
  assert.deepEqual(editor.peek(), ['country:it', 'country:fr'], 'a new country is added to the old one');
  type('Nowhereland');
  key('Enter');
  assert.deepEqual(editor.peek(), ['country:it', 'country:fr']);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  type('');
  assert.equal(input.getAttribute('aria-invalid'), null, 'typing clears the invalid flag');
});

test('a stored country that is not a real one is shown with a warning', () => {
  const { f } = make('country', ['country:nowhere']);
  const chip = f.node.querySelector('.chips').children[0];
  assert.ok(chip.querySelector('svg'));
  assert.equal(chip.textContent, 'nowhere');
  assert.match(chip.getAttribute('title'), /not a known country/);
});

test('commit() with empty input clears the invalid flag and adds nothing', () => {
  const { editor, f, input } = make('genre');
  input.setAttribute('aria-invalid', 'true');
  const { commit } = f;
  commit();
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.deepEqual(editor.peek(), []);
});

test('library genres feed suggestions when the server list fails', async () => {
  stubFetch(() => ({ status: 500, body: {} }));
  resetVocabulary();
  store.songs = [{ id: 'a', tags: ['genre:zydeco'] }, { id: 'b', tags: ['genre:zydeco', 'genre:polka'] }];
  store.listeners.forEach((fn) => fn());
  const { type, input, f } = make('genre');
  input.focus();
  type('zy');
  await flush();
  assert.equal(f.node.querySelector('[role=listbox]').children[0].getAttribute('data-genre'), 'zydeco');
});

test('country input must only accept codes the server knows', async () => {
  const { countryCode } = await import('./metadata-apply.js');
  const { COUNTRY_NAMES } = await import('./countries-data.js');
  const bad = [];
  for (let i = 65; i < 91; i += 1) {
    for (let j = 65; j < 91; j += 1) {
      const c = countryCode(String.fromCharCode(i, j));
      if (c && !(c in COUNTRY_NAMES)) bad.push(c);
    }
  }
  assert.deepEqual(bad, []);
});

test('typing the country name Germany must give country:de', () => {
  const { editor, type, key } = make('country');
  type('Germany');
  key('Enter');
  assert.deepEqual(editor.peek(), ['country:de']);
});

test('an alias, a spelling variant and a trailing "music" resolve to the canonical name', async () => {
  stubFetch((url) => (url === '/genres/vocabulary' ? { body: VOCAB } : { body: {} }));
  resetVocabulary();
  await loadVocabulary();
  const { editor, type, key } = make('genre');
  type('DnB');
  key('Enter');
  type('Hip-Hop');
  key('Enter');
  type('house music');
  key('Enter');
  type('rhythm and blues');
  key('Enter');
  assert.deepEqual(editor.peek(), ['genre:drum and bass', 'genre:hip hop', 'genre:house', 'genre:rhythm & blues']);
});

test('free text is not accepted: an unknown genre stays in the input with did-you-mean chips', () => {
  const { editor, type, key, input, f } = make('genre');
  type('rok');
  key('Enter');
  assert.deepEqual(editor.peek(), []);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(input.value, 'rok');
  const hint = f.node.querySelector('.genre-hint');
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /"rok" is not in the genre list/);
  const buttons = hint.children.filter((c) => c.tagName === 'BUTTON');
  assert.ok(buttons.some((b) => b.title === 'Use rock'));
  buttons.find((b) => b.title === 'Use rock').click();
  assert.deepEqual(editor.peek(), ['genre:rock']);
  assert.equal(hint.hidden, true);
  assert.equal(input.value, '');
});

test('an unknown genre with no close match says so and adds nothing on blur', () => {
  const { editor, type, input, f } = make('genre');
  type('qqqqzzzz');
  input.dispatchEvent(makeEvent('blur'));
  assert.deepEqual(editor.peek(), []);
  assert.equal(f.node.querySelector('.genre-hint').children.filter((c) => c.tagName === 'BUTTON').length, 0);
  type('');
  assert.equal(f.node.querySelector('.genre-hint').hidden, true);
});

test('suggestions show the family dot and the level, and match aliases', async () => {
  const { type, input, f } = make('genre');
  input.focus();
  type('dn');
  await flush();
  const opt = f.node.querySelector('[role=listbox]').children[0];
  assert.equal(opt.getAttribute('data-genre'), 'drum and bass');
  assert.ok(opt.querySelector('.gm-dot'));
  assert.equal(opt.querySelector('small').textContent, 'Electronic');
  assert.equal(opt.getAttribute('title'), 'drum and bass: genre in Electronic');
});

test('a chosen genre chip carries the family dot', () => {
  const { f } = make('genre', ['genre:rock']);
  const chip = f.node.querySelector('.chips').children[0];
  assert.ok(chip.querySelector('.gm-dot'));
  assert.match(chip.getAttribute('title'), /genre in Rock/);
});

test('reject() removes the refused value and offers the server suggestions that exist', () => {
  const { editor, f } = make('genre', ['genre:rock']);
  f.reject({ value: 'rock', suggestions: ['punk', 'not-a-genre'] });
  assert.deepEqual(editor.peek(), []);
  const hint = f.node.querySelector('.genre-hint');
  assert.deepEqual(hint.children.filter((c) => c.tagName === 'BUTTON').map((b) => b.title), ['Use punk']);
});

test('the tag editor does not take a free-text genre: tag', () => {
  const editor = tagEditor({ tags: [], hideNs: true });
  document.body.append(editor.node);
  const input = editor.node.querySelector('input');
  input.value = 'genre:rokk, genre:Hip Hop';
  input.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
  assert.deepEqual(editor.peek(), ['genre:hip hop']);
  assert.equal(editor.node.querySelector('.country-note').hidden, false);
  assert.match(editor.node.querySelector('.country-note').textContent, /genre/);
});
