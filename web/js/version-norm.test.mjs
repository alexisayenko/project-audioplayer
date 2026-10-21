import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVersion } from './version-norm.js';

const CASES = [
  ['(2024 Remastered)', '2024 remaster'],
  ['2024 Remastered', '2024 remaster'],
  ['Remastered 2009', '2009 remaster'],
  ['Remastered', 'remaster'],
  ['Remastered Version', 'remaster'],
  ['re-mastered', 'remaster'],
  ['re mastered', 'remaster'],
  ['Digital Remaster', 'remaster'],
  ['Digitally Remastered 1999 Edition', '1999 remaster'],
  ['2011 Remastered Version', '2011 remaster'],
  ['Radio Edit, 2011 Remastered', 'Radio Edit - 2011 remaster'],
  ['Netsky Remix', 'Netsky Remix'],
  ['Live from the Royal Albert Hall', 'Live from the Royal Albert Hall'],
  ['Deluxe Edition', 'Deluxe Edition'],
  ['Unremastered', 'Unremastered'],
  ['', ''],
];

for (const [input, want] of CASES) {
  test(`normalizeVersion(${JSON.stringify(input)})`, () => {
    assert.equal(normalizeVersion(input), want);
    assert.equal(normalizeVersion(want), want);
  });
}
