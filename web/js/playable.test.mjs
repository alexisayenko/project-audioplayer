import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAudio, sourceLink } from './playable.js';

test('hasAudio follows audio_state, then file', () => {
  assert.equal(hasAudio({ audio_state: 'server' }), true);
  assert.equal(hasAudio({ audio_state: 'none', file: null }), false);
  assert.equal(hasAudio({ file: 'a.m4a' }), true);
  assert.equal(hasAudio({ file: null }), false);
  assert.equal(hasAudio(undefined), false);
});

test('sourceLink labels by provider and ignores non-http urls', () => {
  assert.deepEqual(sourceLink({ sources: [{ source: 'youtube', url: 'https://youtu.be/x' }] }), { url: 'https://youtu.be/x', label: 'Open on YouTube' });
  assert.equal(sourceLink({ sources: [{ source: 'soundcloud', url: 'https://soundcloud.com/a/b' }] }).label, 'Open on SoundCloud');
  assert.equal(sourceLink({ sources: [{ source: 'youtube', url: 'javascript:alert(1)' }] }), null);
  assert.equal(sourceLink({}), null);
});
