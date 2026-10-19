import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('WEB-012: navigation order starts with Library', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)[0];
  const routes = [...nav.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(routes, ['library', 'playback', 'playlists', 'genres', 'stats', 'theory', 'settings']);
});
