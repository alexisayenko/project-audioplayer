import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { referenceBadge } = await import('./song-card.js');
const R = await import('./references.js');

test('no badge without marks', () => {
  R.resetReferences();
  assert.equal(referenceBadge('none'), null);
});
