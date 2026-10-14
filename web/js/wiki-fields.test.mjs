import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent } from './test-dom.mjs';

installDom();
const { wikiFields, wikiNormalize, wikiDisplay, isWikiLink } = await import('./wiki-links.js');

const inputs = (f) => f.node.querySelectorAll('input');
const type = (inp, v) => { inp.value = v; inp.dispatchEvent(makeEvent('input')); };

test('normalize: names become article links, urls are kept, blanks vanish', () => {
  assert.equal(wikiNormalize(''), '');
  assert.equal(wikiNormalize('   '), '');
  assert.equal(wikiNormalize(null), '');
  assert.equal(wikiNormalize('https://de.wikipedia.org/wiki/X'), 'https://de.wikipedia.org/wiki/X');
  const n = wikiNormalize('AC/DC (band)');
  assert.ok(n.startsWith('http'));
  assert.ok(n.includes('AC/DC'));
  assert.ok(!n.includes(' '));
});

test('display round-trips a normalised name', () => {
  assert.equal(wikiDisplay(wikiNormalize('Pink Floyd')), 'Pink Floyd');
  assert.equal(wikiDisplay(''), '');
});

test('fields start from initial values and report them', () => {
  const f = wikiFields({ song: wikiNormalize('Money'), artist: '' });
  const [s, a] = inputs(f);
  assert.equal(s.value, 'Money');
  assert.equal(a.value, '');
  assert.ok(isWikiLink(f.values().wikipedia_song));
  assert.equal(f.values().wikipedia_artist, null);
});

test('typing normalises, flags invalid markup via aria-invalid, blur re-renders', () => {
  const f = wikiFields({});
  const [s] = inputs(f);
  type(s, 'Pink Floyd');
  assert.ok(isWikiLink(f.values().wikipedia_song));
  assert.equal(s.getAttribute('aria-invalid'), 'false');
  s.dispatchEvent(makeEvent('blur'));
  assert.equal(s.value, 'Pink Floyd');
  type(s, '');
  assert.equal(f.values().wikipedia_song, null);
});

test('set() updates only the given side', () => {
  const f = wikiFields({ song: 'A', artist: 'B' });
  f.set({ song: 'C' });
  assert.equal(inputs(f)[0].value, 'C');
  assert.equal(inputs(f)[1].value, 'B');
  f.set({ artist: null });
  assert.equal(f.values().wikipedia_artist, null);
});
