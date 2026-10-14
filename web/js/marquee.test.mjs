import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPage, stubFetch, fire} from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: {} }));
const { marqueeMetrics, prefersReduced, marquee, disposeAll, MIN_OVERFLOW, PAD, measure } = await import('./marquee.js');
const { el } = await import('./dom.js');
const { titleNodes } = await import('./display-title.js');
const { songRow } = await import('./library-rows.js');
const { queueRow } = await import('./player-ui.js');
const { store } = await import('./store.js');

const sized = (box, scroll, client) => {
  Object.defineProperty(box, 'clientWidth', { value: client, configurable: true });
  const track = box.querySelector('.mq-track');
  Object.defineProperty(track, 'scrollWidth', { value: scroll, configurable: true });
};
const later = () => new Promise((r) => setTimeout(r, 5));

test('metrics: threshold, distance and duration', () => {
  assert.deepEqual(marqueeMetrics(0), { overflowing: false, dist: 0, dur: 0 });
  assert.equal(marqueeMetrics(MIN_OVERFLOW).overflowing, false);
  assert.equal(marqueeMetrics(MIN_OVERFLOW + 0.5).overflowing, true);
  assert.deepEqual(marqueeMetrics(100.2), { overflowing: true, dist: 101 + 2 * PAD, dur: (101 + 2 * PAD) / 32 + 3 });
  assert.equal(marqueeMetrics(10).dur, 6);
  assert.equal(marqueeMetrics(1000).dur, (1000 + 2 * PAD) / 32 + 3);
  assert.equal(marqueeMetrics(3).dist, 3 + 2 * PAD);
});

test('metrics: reduced motion disables the animation', () => {
  assert.equal(marqueeMetrics(500, true).overflowing, false);
  assert.equal(prefersReduced(() => ({ matches: true })), true);
  assert.equal(prefersReduced(() => ({ matches: false })), false);
  assert.equal(prefersReduced(null), false);
});

test('wrapping is idempotent and keeps one copy of the text', () => {
  const box = el('div', {}, titleNodes({ title: 'Song', remixer: 'Kav' }));
  marquee(box, { auto: true });
  marquee(box, { auto: true });
  assert.equal(box.querySelectorAll('.mq-track').length, 1);
  assert.equal(box.textContent, 'Song (Kav)');
  assert.ok(box.classList.contains('mq'));
});

test('auto: overflowing content gets run class and vars, fitting content none', async () => {
  const box = el('div', {}, 'A very long title');
  marquee(box, { auto: true });
  sized(box, 300, 100);
  await later();
  assert.ok(box.classList.contains('mq-run'));
  assert.equal(box.style.getPropertyValue('--mq-dist'), `${200 + 2 * PAD}px`);
  assert.equal(box.style.getPropertyValue('--mq-dur'), `${(200 + 2 * PAD) / 32 + 3}s`);
  sized(box, 300 + 2 * PAD, 100);
  measure(box);
  assert.equal(box.style.getPropertyValue('--mq-dist'), `${200 + 2 * PAD}px`);
  const fit = el('div', {}, 'Short');
  marquee(fit, { auto: true });
  sized(fit, 100, 101);
  await later();
  assert.equal(fit.classList.contains('mq-run'), false);
  assert.equal(fit.style.getPropertyValue('--mq-dist'), '');
  disposeAll(el('div', {}, box, fit));
});

test('non-auto: runs on hover and focus only, stops on leave and blur', async () => {
  const box = el('div', {}, 'A very long title');
  const row = el('li', {}, box);
  marquee(box, { host: row });
  sized(box, 300, 100);
  await later();
  assert.equal(box.classList.contains('mq-run'), false);
  fire(row, 'mouseenter', { bubbles: false });
  assert.ok(box.classList.contains('mq-run'));
  fire(row, 'mouseleave', { bubbles: false });
  assert.equal(box.classList.contains('mq-run'), false);
  fire(row, 'focusin');
  assert.ok(box.classList.contains('mq-run'));
  fire(row, 'focusout', { relatedTarget: null });
  assert.equal(box.classList.contains('mq-run'), false);
});

test('hover on fitting content does not animate', () => {
  const box = el('div', {}, 'Short');
  const row = el('li', {}, box);
  marquee(box, { host: row });
  sized(box, 50, 100);
  fire(row, 'mouseenter', { bubbles: false });
  assert.equal(box.classList.contains('mq-run'), false);
});

test('renderers: current rows auto-run, other rows only on hover', async () => {
  const cur = { id: 'm1', title: 'Song', artist: 'Zed', remixer: 'Kav', file: 'm1.mp3', tags: [] };
  const other = { id: 'm2', title: 'Other', artist: 'Zed', file: 'm2.mp3', tags: [] };
  const a = songRow(cur, cur, null);
  const b = songRow(other, cur, null);
  for (const r of [a, b]) {
    const open = r.querySelector('.open');
    assert.ok(open.classList.contains('mq'));
    assert.equal(open.querySelectorAll('.mq-track').length, 1);
    sized(open, 300, 100);
  }
  await later();
  assert.ok(a.querySelector('.open').classList.contains('mq-run'));
  assert.equal(b.querySelector('.open').classList.contains('mq-run'), false);
  fire(b, 'mouseenter', { bubbles: false });
  assert.ok(b.querySelector('.open').classList.contains('mq-run'));
  store.songs = [cur, other];
  store.loaded = true;
  const noop = () => {};
  const ctx = { count: 2, index: 0, move: noop, removeAt: noop, playAt: noop };
  const q0 = queueRow({ id: 'm1' }, 0, ctx);
  const q1 = queueRow({ id: 'm2' }, 1, ctx);
  for (const r of [q0, q1]) sized(r.querySelector('.open'), 300, 100);
  await later();
  assert.ok(q0.querySelector('.open').classList.contains('mq-run'));
  assert.equal(q1.querySelector('.open').classList.contains('mq-run'), false);
});

test('mini-player and playback heading use the module; css has the rules', () => {
  const js = readFileSync(new URL('./player.js', import.meta.url), 'utf8');
  assert.match(js, /marquee\(\$\('mini-title'\), \{ auto: true \}\)/);
  assert.match(js, /marquee\(\$\('player-title'\), \{ auto: true \}\)/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes mq/);
  assert.match(css, /\.mq-run \.mq-track \{[^}]*animation: mq var\(--mq-dur/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.mq-run \.mq-track \{ animation: none/);
  assert.match(css, /\.doc-hidden \.mq-track \{ animation-play-state: paused/);
});

test('css: padding matches PAD, covers the fade, mask sits on the container', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const pad = Number(/--mq-pad: (\d+)px/.exec(css)[1]);
  const fade = Number(/--mq-fade: (\d+)px/.exec(css)[1]);
  assert.equal(pad, PAD);
  assert.ok(pad >= fade);
  assert.match(css, /\.mq-run \{ -webkit-mask-image: linear-gradient\(90deg, transparent, #000 var\(--mq-fade\), #000 calc\(100% - var\(--mq-fade\)\), transparent\)/);
  assert.match(css, /\.mq-run \.mq-track \{ padding-inline: var\(--mq-pad\)/);
  assert.doesNotMatch(css, /\.mq-track \{[^}]*mask-image/);
  const content = 300;
  const dist = 200 + 2 * pad;
  assert.ok(pad >= fade);
  assert.equal(pad + content - dist, 100 - pad);
});
