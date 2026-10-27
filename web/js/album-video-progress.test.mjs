import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom({ ids: ['toast', 'audio', 'mini-viz'] });
const { progressText, fraction } = await import('./album-video-progress.js');

test('progress texts and fractions', () => {
  assert.match(progressText({ state: 'queued' }), /Waiting/);
  assert.match(progressText({ state: 'downloading' }), /Downloading/);
  assert.equal(progressText({ state: 'splitting', done: 3, total: 10, current: 'Two' }), 'Cutting 3 of 10 tracks: Two');
  assert.equal(progressText({ state: 'done', total: 1 }), 'Done: 1 track cut.');
  assert.equal(progressText({ state: 'error' }), 'Stopped before all tracks were cut.');
  assert.equal(fraction({ state: 'splitting', done: 1, total: 4 }), 0.25);
  assert.equal(fraction({ state: 'downloading' }), 0);
  assert.equal(fraction({ state: 'done' }), 1);
});
