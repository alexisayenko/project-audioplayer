import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fire } from './test-dom.mjs';

const dom = installDom();
const { openMenu, closeMenu, initMenus } = await import('./menu.js');
initMenus();

const mkBtn = () => { const b = document.createElement('button'); document.body.append(b); return b; };
const menus = () => document.body.querySelectorAll('.menu');

test('open shows items, focuses the first enabled, marks aria-expanded', () => {
  const b = mkBtn();
  openMenu(b, [{ label: 'Off', disabled: true, run() {} }, { label: 'Edit', run() {} }, { label: 'Delete', danger: true, run() {} }]);
  assert.equal(menus().length, 1);
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  const items = menus()[0].querySelectorAll('button');
  assert.equal(items.length, 3);
  assert.equal(items[0].disabled, true);
  assert.ok(items[2].classList.contains('danger'));
  assert.equal(document.activeElement, items[1]);
  closeMenu();
  assert.equal(menus().length, 0);
  assert.equal(b.getAttribute('aria-expanded'), 'false');
});

test('choosing an item closes the menu and runs it', () => {
  const b = mkBtn();
  let ran = 0;
  openMenu(b, [{ label: 'Go', run: () => { ran += 1; } }]);
  menus()[0].querySelector('button').click();
  assert.equal(ran, 1);
  assert.equal(menus().length, 0);
});

test('same trigger toggles; another trigger replaces', () => {
  const a = mkBtn();
  const b = mkBtn();
  openMenu(a, [{ label: 'x', run() {} }]);
  openMenu(a, [{ label: 'x', run() {} }]);
  assert.equal(menus().length, 0);
  openMenu(a, [{ label: 'x', run() {} }]);
  openMenu(b, [{ label: 'y', run() {} }]);
  assert.equal(menus().length, 1);
  assert.equal(a.getAttribute('aria-expanded'), 'false');
  closeMenu();
  closeMenu();
});

test('outside click, Escape, resize and scroll close it; inside click does not', () => {
  const b = mkBtn();
  const outside = mkBtn();
  const open = () => openMenu(b, [{ label: 'x', run() {} }]);
  open();
  fire(menus()[0], 'click');
  assert.equal(menus().length, 1);
  fire(outside, 'click');
  assert.equal(menus().length, 0);
  open();
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(menus().length, 0);
  assert.equal(document.activeElement, b, 'focus returns to the trigger');
  open();
  dom.window.dispatch('resize');
  assert.equal(menus().length, 0);
  open();
  dom.window.dispatch('scroll');
  assert.equal(menus().length, 0);
  open();
  document.dispatchEvent({ type: 'keydown', key: 'a' });
  assert.equal(menus().length, 1);
  closeMenu();
});
