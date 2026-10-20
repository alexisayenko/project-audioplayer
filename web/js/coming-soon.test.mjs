import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { renderPlaylists } = await import('./playlists.js');

for (const [name, render, title, text] of [
  ['Playlists', renderPlaylists, 'Playlists', 'Playlists are coming soon.'],
]) {
  test(`${name}: the placeholder page has the standard head and the coming-soon text`, () => {
    const root = document.createElement('div');
    render(root);
    assert.equal(root.querySelector('h1').textContent, title);
    assert.ok(root.querySelector('.page-head'));
    assert.equal(root.querySelector('.state.card p').textContent, text);
  });
}
