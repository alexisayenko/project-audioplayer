import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const vizCss = readFileSync(new URL('../viz.css', import.meta.url), 'utf8');

test('Now playing builds no tray, progress bar, times or volume of its own', () => {
  const at = html.indexOf('<section id="player"');
  const player = html.slice(at, html.indexOf('</section>', at));
  for (const id of ['p-play', 'p-prev', 'p-next', 'p-shuffle', 'p-repeat', 'p-mute', 'p-volume', 'scrub', 't-cur', 't-dur']) {
    assert.ok(!player.includes(`id="${id}"`), id);
  }
  assert.ok(!player.includes('class="tray"'));
});

test('the dock stays visible on the playback route; only the library page behind it is hidden', () => {
  assert.ok(css.includes('body[data-route="playback"] main { display: none; }'));
  assert.ok(!css.includes('data-route="playback"] .mini'));
  assert.ok(vizCss.includes('body.viz-full-open .mini { display: none; }'));
});

test('every id in index.html is unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), []);
});
