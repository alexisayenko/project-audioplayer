import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, compose, removeToken, replaceToken, appendToken, moveToken, insertToken, moveTokenTo, stripEdges, commitTyped, endsWithSeparator, splitTokens, joinTokens, SEPARATOR } from './tokens.js';

const texts = (s) => tokenize(s).map((t) => t.text);

test('splits only on a spaced dash', () => {
  assert.deepEqual(splitTokens('De Hofnar - Zonnestraal'), ['De Hofnar', 'Zonnestraal']);
  assert.deepEqual(splitTokens('A – B — C'), ['A', 'B', 'C']);
  assert.deepEqual(splitTokens('A  -  B'), ['A', 'B']);
  assert.equal(SEPARATOR, ' - ');
});

test('commas, semicolons, ampersands, slashes, pipes never split', () => {
  for (const s of ['Tyler, The Creator', 'Earth, Wind & Fire', 'A; B', 'Лондон, гуд бай', 'AC/DC', '24/7', '1/2', 'A|B', 'A/ B', 'A /B', "Guns N' Roses/Alice", 'A feat. B', 'A x B', 'A ●● B', 'Rover (Extended Mix)', 'Dr. Dre', 'Q. Smith']) {
    assert.deepEqual(splitTokens(s), [s]);
  }
});

test('hyphens inside words and unspaced dashes never split', () => {
  for (const s of ['Jean-Michel Jarre', 'A-ha', 'Би-2', 'A -B', 'A- B', 'A–B']) assert.deepEqual(splitTokens(s), [s]);
});

test('three tokens, edges and empty', () => {
  assert.deepEqual(splitTokens('A - B - C'), ['A', 'B', 'C']);
  assert.deepEqual(splitTokens(' - A - '), ['A']);
  assert.deepEqual(splitTokens('A - '), ['A']);
  assert.deepEqual(splitTokens(''), []);
  assert.deepEqual(splitTokens(null), []);
  assert.equal(joinTokens(['A', ' B ', '', 'C']), 'A - B - C');
  assert.equal(joinTokens([]), '');
});

test('round trip leaves every stored string untouched', () => {
  for (const s of ['A, B', 'Tyler, The Creator', 'A – B', 'A — B - C', 'A  -  B', ' - A - ', 'A - ', '', 'Земфира, Би-2']) {
    assert.equal(compose(tokenize(s)), s);
    if (s.trim() === '' || !/ [-–—] $| ^[-–—] /.test(s)) assert.equal(stripEdges(s), s.trim());
  }
  assert.equal(stripEdges('A – B'), 'A – B');
});

test('removeToken first, middle, last, only', () => {
  assert.equal(removeToken('A - B - C', 0), 'B - C');
  assert.equal(removeToken('A - B - C', 1), 'A - C');
  assert.equal(removeToken('A - B - C', 2), 'A - B');
  assert.equal(removeToken('A, B', 0), '');
  assert.equal(removeToken('Solo', 0), '');
});

test('replaceToken keeps separators', () => {
  assert.equal(replaceToken('A – B', 1, 'X'), 'A – X');
  assert.equal(replaceToken('A - B', 0, ''), 'B');
  assert.equal(replaceToken('Tyler, The Creator', 0, 'Tyler, The Creator!'), 'Tyler, The Creator!');
});

test('appendToken joins with the separator', () => {
  assert.equal(appendToken('', 'A', SEPARATOR), 'A');
  assert.equal(appendToken('A', 'B', SEPARATOR), 'A - B');
  assert.equal(appendToken('A, B', 'C', SEPARATOR), 'A, B - C');
  assert.equal(appendToken('A - ', 'B', SEPARATOR), 'A - B');
  assert.equal(endsWithSeparator('A - '), true);
  assert.equal(endsWithSeparator('A, '), false);
});

test('moveToken between fields', () => {
  assert.deepEqual(moveToken('De Hofnar - Zonnestraal', 0, 'KAV', SEPARATOR), { src: 'Zonnestraal', dst: 'KAV - De Hofnar' });
  assert.deepEqual(moveToken('Solo', 0, '', SEPARATOR), { src: '', dst: 'Solo' });
});

test('commitTyped needs the exact separator', () => {
  assert.deepEqual(commitTyped('', 'A, B', SEPARATOR), { value: '', rest: 'A, B' });
  assert.deepEqual(commitTyped('', 'A; B & C', SEPARATOR), { value: '', rest: 'A; B & C' });
  assert.deepEqual(commitTyped('', 'A - Bo', SEPARATOR), { value: 'A - ', rest: 'Bo' });
  assert.equal(stripEdges(commitTyped('X', 'A - ', SEPARATOR).value), 'X - A');
});

test('insertToken and moveTokenTo', () => {
  assert.equal(insertToken('A - C', 1, 'B', SEPARATOR), 'A - B - C');
  assert.deepEqual(moveTokenTo('A - B - C', 0, 'A - B - C', 3, SEPARATOR, true), { src: 'B - C - A', dst: 'B - C - A' });
  assert.deepEqual(moveTokenTo('A - B', 0, 'X', 1, SEPARATOR, false), { src: 'B', dst: 'X - A' });
});

test('spaced slash and pipe separate; unspaced never', () => {
  const table = [
    ['A / B', ['A', 'B']], ['A // B', ['A', 'B']], ['A | B', ['A', 'B']],
    ['A ／ B', ['A', 'B']], ['A ｜ B', ['A', 'B']], ['A ／／ B', ['A', 'B']],
    ['AC/DC - Back In Black', ['AC/DC', 'Back In Black']], ['A - B / C | D', ['A', 'B', 'C', 'D']],
    ['A /// B', ['A /// B']], ['A / ', ['A']], ['24/7 | X', ['24/7', 'X']], ['Artist | Title', ['Artist', 'Title']],
  ];
  for (const [s, want] of table) assert.deepEqual(splitTokens(s), want, s);
});

test('stored pipe string is kept verbatim until edited, then joined with the dash', () => {
  const s = 'Artist | Title';
  assert.equal(compose(tokenize(s)), s);
  assert.equal(stripEdges(s), s);
  assert.equal(replaceToken(s, 1, 'Other'), 'Artist | Other');
  assert.equal(appendToken(s, 'C', SEPARATOR), 'Artist | Title - C');
  assert.equal(joinTokens(splitTokens(s)), 'Artist - Title');
});
