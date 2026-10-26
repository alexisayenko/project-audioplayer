import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('WEB-012: navigation order starts with Library; Genres map v2 follows Genres map; Studio sits between Statistics and Help; Music theory lives under Help; every entry is a route', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)[0];
  const routes = [...nav.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
  const table = readFileSync(new URL('./app.js', import.meta.url), 'utf8').match(/const routes = \{([\s\S]*?)\n\};/)[1];
  const known = new Set([...table.matchAll(/^\s+'?([\w-]+)'?:/gm)].map((m) => m[1]));
  for (const r of routes) assert.ok(known.has(r.split('/')[0]), `${r} is in the route table`);
  assert.equal(new Set(routes).size, routes.length);
  assert.equal(routes[0], 'library');
  assert.equal(routes.indexOf('genres2'), routes.indexOf('genres') + 1);
  const at = (needle) => nav.indexOf(needle);
  assert.ok(at('data-route="stats"') < at('data-route="studio"') && at('data-route="studio"') < at('id="help-toggle"') && at('id="help-toggle"') < at('data-route="settings"'));
  assert.ok(at('id="help-toggle"') < at('data-route="theory"') && at('data-route="theory"') < at('data-route="settings"'));
});

test('GEN-101: Genres map v2 sits directly under Genres map with the same icon and its tooltip', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<a href="#\/genres" data-route="genres" title="Genres map"><span data-icon="genresMap" aria-hidden="true"><\/span><span class="nav-label">Genres map<\/span><\/a>\s*<a href="#\/genres2" data-route="genres2" title="Genres map v2: with the genre info dock"><span data-icon="genresMap" aria-hidden="true"><\/span><span class="nav-label">Genres map v2<\/span><\/a>/);
});
