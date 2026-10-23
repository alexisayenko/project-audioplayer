import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('WEB-012: navigation order starts with Library; Genres map v2 follows Genres map; Studio sits between Statistics and Help; Music theory lives under Help', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)[0].replace(/<ul class="nav-sub"[\s\S]*?<\/ul>/, '');
  const routes = [...nav.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(routes, ['library', 'playback', 'playlists', 'genres', 'genres2', 'stats', 'studio', 'settings']);
  assert.ok(nav.indexOf('id="help-toggle"') > nav.indexOf('data-route="studio"') && nav.indexOf('data-route="studio"') > nav.indexOf('data-route="stats"') && nav.indexOf('id="help-toggle"') < nav.indexOf('data-route="settings"'));
});

test('GEN-101: Genres map v2 sits directly under Genres map with the same icon and its tooltip', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<a href="#\/genres" data-route="genres" title="Genres map"><span data-icon="genresMap" aria-hidden="true"><\/span><span class="nav-label">Genres map<\/span><\/a>\s*<a href="#\/genres2" data-route="genres2" title="Genres map v2: with the genre info dock"><span data-icon="genresMap" aria-hidden="true"><\/span><span class="nav-label">Genres map v2<\/span><\/a>/);
});
