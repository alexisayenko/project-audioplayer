import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { originalGenres, originalBox } = await import('./original-genres.js');

test('original genres: only new genre tags, deduped', () => {
  const resp = { original_genres: ['genre:art pop', 'genre:Art Pop', 'genre:synthpop', 'country:gb', 'x', 'genre:'] };
  assert.deepEqual(originalGenres(resp, ['genre:synthpop']), ['genre:art pop', 'genre:Art Pop']);
  assert.deepEqual(originalGenres({}, []), []);
  assert.deepEqual(originalGenres({ original_genres: 'genre:pop' }, []), []);
});

test('original genres box: hidden when empty, a click picks one tag and removes it', () => {
  const picked = [];
  const box = originalBox((t) => picked.push(t));
  assert.equal(box.node.hidden, true);
  box.set(['genre:art pop', 'genre:synthpop']);
  assert.equal(box.node.hidden, false);
  assert.match(box.node.textContent, /From the original \(not applied\)/);
  const buttons = box.node.querySelectorAll('button');
  assert.equal(buttons.length, 2);
  buttons[0].click();
  assert.deepEqual(picked, ['genre:art pop']);
  assert.equal(box.node.querySelectorAll('button').length, 1);
  box.clear();
  assert.equal(box.node.hidden, true);
});
