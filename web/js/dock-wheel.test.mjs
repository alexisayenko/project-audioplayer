import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { installPage, stubFetch, makeEvent } from './test-dom.mjs';

await installPage();
globalThis.location = { hash: '', href: 'http://localhost/', host: 'localhost' };
stubFetch(() => ({ body: { songs: [] } }));
const { initPlayer, player } = await import('./player.js');
initPlayer();
const { wheelPixels } = await import('./dock-wheel.js');

const $ = (id) => document.getElementById(id);
const dock = $('mini');
dock.hidden = false;

function wheel(deltaY, init = {}, target = dock) {
  const ev = makeEvent('wheel', { bubbles: true, deltaY, deltaMode: 0, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}
const pct = () => Math.round(player.volume * 100);
const reset = (v) => { player.setVolume(v / 100); dock.hidden = false; };

test('wheel up raises and wheel down lowers by 5 points per notch', () => {
  reset(50);
  wheel(-100);
  assert.equal(pct(), 55);
  wheel(100);
  wheel(100);
  assert.equal(pct(), 45);
});

test('the slider, aria value and saved volume follow', () => {
  reset(50);
  wheel(-100);
  assert.equal(String($('mini-volume').value), '55');
  assert.equal(localStorage.getItem('ap2.volume'), '0.55');
});

test('clamps at 0 and 100', () => {
  reset(98);
  wheel(-100);
  assert.equal(pct(), 100);
  wheel(-100);
  assert.equal(pct(), 100);
  reset(3);
  wheel(100);
  assert.equal(pct(), 0);
});

test('Shift gives the fine 1 point step', () => {
  reset(50);
  wheel(-100, { shiftKey: true });
  assert.equal(pct(), 51);
});

test('small deltas accumulate until a full notch', () => {
  reset(50);
  for (let i = 0; i < 3; i += 1) wheel(-30);
  assert.equal(pct(), 50);
  wheel(-30);
  assert.equal(pct(), 55);
  wheel(-4);
  assert.equal(pct(), 55);
});

test('line and page delta modes are normalised', () => {
  assert.equal(wheelPixels({ deltaY: 3, deltaMode: 1 }), 120);
  assert.equal(wheelPixels({ deltaY: 1, deltaMode: 2 }, 800), 800);
  reset(50);
  wheel(-3, { deltaMode: 1 });
  assert.equal(pct(), 55);
});

test('a tiny delta is ignored and does not block scrolling', () => {
  reset(50);
  const ev = wheel(0.2);
  assert.equal(pct(), 50);
  assert.equal(ev.defaultPrevented, false);
});

test('the page scroll is blocked while the volume changes', () => {
  reset(50);
  assert.equal(wheel(-100).defaultPrevented, true);
});

test('Ctrl keeps the browser zoom', () => {
  reset(50);
  const ev = wheel(-100, { ctrlKey: true });
  assert.equal(pct(), 50);
  assert.equal(ev.defaultPrevented, false);
});

test('a hidden dock does nothing and leaves the page scroll alone', () => {
  reset(50);
  dock.hidden = true;
  const ev = wheel(-100);
  assert.equal(pct(), 50);
  assert.equal(ev.defaultPrevented, false);
});

test('a menu inside the dock scrolls itself', () => {
  reset(50);
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  dock.append(menu);
  const ev = wheel(-100, {}, menu);
  menu.remove();
  assert.equal(pct(), 50);
  assert.equal(ev.defaultPrevented, false);
});

test('a wheel increase unmutes', () => {
  reset(50);
  player.toggleMute();
  assert.equal(player.muted, true);
  wheel(-100);
  assert.equal(player.muted, false);
  assert.equal(pct(), 5);
});

test('feedback shows the percentage and announces it, then hides', async () => {
  reset(50);
  wheel(-100);
  assert.equal($('mini-vol-pct').textContent, '55%');
  assert.equal($('mini-vol-sr').textContent, 'Volume 55%');
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="mini-vol-note"[^>]*aria-live="polite"/);
  assert.equal($('mini-vol-note').classList.contains('show'), true);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal($('mini-vol-note').classList.contains('show'), false);
});
