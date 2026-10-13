import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, compose, removeToken, replaceToken, appendToken, moveToken, insertToken, moveTokenTo, stripEdges, commitTyped, endsWithSeparator } from './tokens.js';

const texts = (s) => tokenize(s).map((t) => t.text);
const seps = (s) => tokenize(s).map((t) => t.sep);

test('Alex example splits on dash and pipe', () => {
  const s = 'Gala - Freed From Desire | Progressive Rework';
  assert.deepEqual(texts(s), ['Gala', 'Freed From Desire', 'Progressive Rework']);
  assert.deepEqual(seps(s), [' - ', ' | ', '']);
});

test('comma list keeps Q. and initials whole', () => {
  const s = 'Sadrican, DJ Harley Q., DJ Anna Fahrenheit, GOLDFISH';
  assert.deepEqual(texts(s), ['Sadrican', 'DJ Harley Q.', 'DJ Anna Fahrenheit', 'GOLDFISH']);
  assert.deepEqual(seps(s), [', ', ', ', ', ', '']);
  assert.deepEqual(texts('J. R. R. Tolkien'), ['J. R. R. Tolkien']);
});

test('hyphenated words and parentheses stay inside a token', () => {
  assert.deepEqual(texts('Hip-Hop - Mix'), ['Hip-Hop', 'Mix']);
  assert.deepEqual(texts('Jean-Michel Jarre'), ['Jean-Michel Jarre']);
  assert.deepEqual(texts('A - B (Sadrican Remix)'), ['A', 'B (Sadrican Remix)']);
  assert.deepEqual(texts('Sadrican 2026 Remix'), ['Sadrican 2026 Remix']);
  assert.deepEqual(texts('AC/DC'), ['AC/DC']);
  assert.deepEqual(texts('A / B'), ['A', 'B']);
});

test('period rules', () => {
  assert.deepEqual(texts('Hello World. Next Part'), ['Hello World', 'Next Part']);
  assert.deepEqual(texts('Song feat. Someone'), ['Song feat. Someone']);
  assert.deepEqual(texts('Best Of Vol. 2'), ['Best Of Vol. 2']);
  assert.deepEqual(texts('Mr. Brightside'), ['Mr. Brightside']);
  assert.deepEqual(texts('Version 1.5 Mix'), ['Version 1.5 Mix']);
  assert.deepEqual(texts('Wait... Now'), ['Wait... Now']);
  assert.deepEqual(texts('Mix. extended'), ['Mix. extended']);
});

test('other separators', () => {
  assert.deepEqual(texts('A: B; C • D ●● E – F — G'), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.deepEqual(texts('12:30 Mix'), ['12:30 Mix']);
  assert.deepEqual(texts('1,000 Ways'), ['1,000 Ways']);
  assert.deepEqual(texts('A|B'), ['A', 'B']);
  assert.deepEqual(seps('A|B'), ['|', '']);
});

test('empty and edge strings', () => {
  assert.deepEqual(tokenize(''), [{ text: '', sep: '' }]);
  assert.deepEqual(texts('| A'), ['', 'A']);
  assert.deepEqual(texts('A |'), ['A', '']);
  assert.deepEqual(texts('A | | B'), ['A', 'B']);
  assert.deepEqual(seps('A | | B'), [' | | ', '']);
  assert.equal(endsWithSeparator('A, '), true);
  assert.equal(endsWithSeparator('A'), false);
});

const TRICKY = [
  '', ' ', '   ', 'A', ' A ', 'A - B', 'A -', '- A', ' - ', '|', '||', ', ,', 'A,B', 'A , B', 'A,', ',A',
  'A | | B', 'Gala - Freed From Desire | Progressive Rework', 'Sadrican, DJ Harley Q., DJ Anna Fahrenheit, GOLDFISH',
  'Hip-Hop - Mix', 'A - B (Sadrican Remix)', 'Hello World. Next', 'Hello World.', 'Hello World. ', '... ... ',
  'a ●● b', '●●', ' • ', 'x:y', 'x: y', 'x :', '—', 'A — B – C - D',
  'tab\tseparated\t-\tsample', 'new\nline | x', 'Mr. Brightside, Vol. 2 | feat. X', 'Жук. Тест - Микс',
];

test('round trip for tricky strings', () => {
  for (const s of TRICKY) assert.equal(compose(tokenize(s)), s, JSON.stringify(s));
});

test('removeToken first, middle, last, only', () => {
  const s = 'A - B | C';
  assert.equal(removeToken(s, 0), 'B | C');
  assert.equal(removeToken(s, 1), 'A - C');
  assert.equal(removeToken(s, 2), 'A - B');
  assert.equal(removeToken('Solo', 0), '');
  assert.equal(removeToken(s, 9), s);
});

test('replaceToken keeps separators and re-tokenizes', () => {
  assert.equal(replaceToken('A - B | C', 1, 'Bee'), 'A - Bee | C');
  assert.equal(replaceToken('A - B', 1, ''), 'A');
  assert.deepEqual(texts(replaceToken('A - B', 1, 'X, Y')), ['A', 'X', 'Y']);
});

test('appendToken', () => {
  assert.equal(appendToken('', 'Foo', ', '), 'Foo');
  assert.equal(appendToken('A', 'Foo', ', '), 'A, Foo');
  assert.equal(appendToken('A  ', ' Foo ', ' - '), 'A - Foo');
  assert.equal(appendToken('A, ', 'Foo', ' - '), 'A, Foo');
  assert.equal(appendToken('A,', 'Foo', ' - '), 'A, Foo');
  assert.equal(appendToken('A', '  ', ', '), 'A');
});

test('moveToken between fields', () => {
  assert.deepEqual(moveToken('Gala - Remix Guy', 1, 'Sadrican', ', '), { src: 'Gala', dst: 'Sadrican, Remix Guy' });
  assert.deepEqual(moveToken('Only', 0, '', ' '), { src: '', dst: 'Only' });
  assert.deepEqual(moveToken('A |', 1, 'X', ' '), { src: 'A |', dst: 'X' });
});

test('stripEdges and commitTyped', () => {
  assert.equal(stripEdges('Mix, '), 'Mix');
  assert.equal(stripEdges('| A |'), 'A');
  assert.equal(stripEdges('A - B'), 'A - B');
  assert.deepEqual(commitTyped('', 'Foo,', ', '), { value: 'Foo,', rest: '' });
  assert.deepEqual(commitTyped('A', 'Foo, Ba', ', '), { value: 'A, Foo, ', rest: 'Ba' });
  assert.deepEqual(commitTyped('A', 'Foo', ', '), { value: 'A', rest: 'Foo' });
  assert.deepEqual(commitTyped('A, ', ' | x', ', '), { value: 'A, ', rest: 'x' });
});

test('insertToken puts the token before index', () => {
  assert.equal(insertToken('', 0, 'Foo', ', '), 'Foo');
  assert.equal(insertToken('A, B', 0, 'Foo', ', '), 'Foo, A, B');
  assert.equal(insertToken('A, B', 1, 'Foo', ' - '), 'A, Foo - B');
  assert.equal(insertToken('A - B | C', 2, 'X', ', '), 'A - B | X, C');
  assert.equal(insertToken('A, B', 2, 'Foo', ' - '), appendToken('A, B', 'Foo', ' - '));
  assert.equal(insertToken('A, B', 99, 'Foo', ', '), 'A, B, Foo');
  assert.equal(insertToken('A', 0, '  ', ', '), 'A');
  assert.equal(insertToken('| A', 0, 'X', ', '), '| X, A');
  assert.equal(insertToken('A, ', 1, 'X', ', '), 'A, X');
  for (const s of ['A, B', '| A |', 'A - B | C', ' x ']) {
    const r = insertToken(s, 1, 'Foo', ', ');
    assert.equal(compose(tokenize(r)), r);
  }
});

test('moveTokenTo across and within fields', () => {
  assert.deepEqual(moveTokenTo('Gala - Remix Guy', 1, 'Sadrican, X', 0, ', '), { src: 'Gala', dst: 'Remix Guy, Sadrican, X' });
  assert.deepEqual(moveTokenTo('Gala - Guy', 0, 'S, X', 1, ', '), { src: 'Guy', dst: 'S, Gala, X' });
  assert.deepEqual(moveTokenTo('Only', 0, '', 5, ' '), { src: '', dst: 'Only' });
  assert.deepEqual(moveTokenTo('A, B, C', 0, 'A, B, C', 3, ', '), { src: 'B, C, A', dst: 'B, C, A' });
  assert.deepEqual(moveTokenTo('A, B, C', 2, 'A, B, C', 0, ', '), { src: 'C, A, B', dst: 'C, A, B' });
  assert.deepEqual(moveTokenTo('A, B, C', 0, 'A, B, C', 2, ', '), { src: 'B, A, C', dst: 'B, A, C' });
  assert.deepEqual(moveTokenTo('A, B, C', 1, 'A, B, C', 1, ' - '), { src: 'A, B, C', dst: 'A, B, C' });
  assert.deepEqual(moveTokenTo('A, B, C', 1, 'A, B, C', 2, ' - '), { src: 'A, B, C', dst: 'A, B, C' });
  assert.deepEqual(moveTokenTo('A, B', 1, 'A, B', 99, ' - '), { src: 'A, B', dst: 'A, B' });
  assert.deepEqual(moveTokenTo('A', 0, 'A', 0, ', ', false), { src: '', dst: 'A, A' });
  assert.deepEqual(moveTokenTo('A |', 1, 'X', 0, ' '), { src: 'A |', dst: 'X' });
});
