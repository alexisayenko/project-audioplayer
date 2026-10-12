import assert from 'node:assert/strict';
import { cleanUrl, cleanPasted } from './url-clean.js';

const V = 'jNQXAC9IVRw';
const C = `https://www.youtube.com/watch?v=${V}`;
for (const raw of [
  `https://youtu.be/${V}?si=abc123`,
  `https://youtu.be/${V}?t=42&si=abc123`,
  `https://www.youtube.com/watch?v=${V}&si=abc123`,
  `https://www.youtube.com/watch?si=abc123&v=${V}`,
  `https://www.youtube.com/watch?feature=share&v=${V}&pp=x&utm_source=a`,
  `https://m.youtube.com/watch?v=${V}&t=5s`,
  `https://music.youtube.com/watch?v=${V}&si=abc&list=RDAMVM${V}`,
  `https://www.youtube.com/shorts/${V}?si=abc`,
  `https://www.youtube.com/embed/${V}?feature=oembed`,
  `https://www.youtube.com/live/${V}?si=abc`,
  `youtube.com/watch?v=${V}`,
  `  ${C}  `,
  C,
  V,
]) assert.equal(cleanUrl(raw), C, raw);

assert.equal(cleanUrl('https://example.com/a?id=7&utm_source=x&UTM_medium=y&si=1&fbclid=z&gclid=g&pp=p&feature=f'), 'https://example.com/a?id=7');
assert.equal(cleanUrl('https://example.com/a?si=1'), 'https://example.com/a');
assert.equal(cleanUrl('https://example.com/a?id=7#frag'), 'https://example.com/a?id=7#frag');
assert.equal(cleanUrl('nonsense'), 'nonsense');
assert.equal(cleanUrl('ftp://example.com/a?si=1'), 'ftp://example.com/a?si=1');
assert.equal(cleanUrl(''), '');
const P = 'S-u6qdeaPoE';
const PC = `https://www.youtube.com/watch?v=${P}`;
for (const raw of [
  `https://youtu.be/${P}?si=CHT3sdfIXci1E7k-`,
  `\n  https://youtu.be/${P}?si=CHT3sdfIXci1E7k-  \r\n`,
  `https://youtu.be/${P}?si=a\nhttps://youtu.be/AAAAAAAAAAA`,
  `listen to this: https://youtu.be/${P}?si=abc, nice`,
  `youtu.be/${P}?si=abc`,
]) assert.equal(cleanPasted(raw), PC, raw);
assert.equal(cleanPasted('some words'), 'some words');
assert.equal(cleanPasted(''), '');
console.log('url-clean tests passed');
