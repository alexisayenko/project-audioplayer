import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom({ ids: ['toast'] });
const { downloadSong } = await import('./download.js');

test('downloadSong clicks a hidden anchor to the download url and cleans up', () => {
  let href = null;
  let clicked = 0;
  const orig = document.createElement;
  document.createElement = (t) => {
    const n = orig(t);
    if (t === 'a') n.click = () => { clicked += 1; href = n.getAttribute('href'); };
    return n;
  };
  downloadSong({ id: 'a b/c' });
  document.createElement = orig;
  assert.equal(clicked, 1);
  assert.equal(href, '/files/a%20b%2Fc?download=1', 'id is percent-encoded');
  assert.equal(document.body.querySelectorAll('a').length, 0);
  assert.equal(document.getElementById('toast').textContent, 'Download started');
});
