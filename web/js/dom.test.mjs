import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom({ ids: ['toast'] });
const { el, fmtTime, plural, toast, pageHead, field } = await import('./dom.js');

test('fmtTime handles hours, junk and negatives', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(59.9), '0:59');
  assert.equal(fmtTime(61), '1:01');
  assert.equal(fmtTime(3661), '1:01:01');
  assert.equal(fmtTime(-1), '0:00');
  assert.equal(fmtTime(NaN), '0:00');
  assert.equal(fmtTime(Infinity), '0:00');
});

test('plural', () => {
  assert.equal(plural(1, 'song', 'songs'), 'song');
  assert.equal(plural(0, 'song', 'songs'), 'songs');
  assert.equal(plural(2, 'song', 'songs'), 'songs');
});

test('el sets class, handlers, attributes, skips null/false and flattens children', () => {
  let clicked = 0;
  const n = el('button', { class: 'a b', type: 'button', onclick: () => { clicked += 1; }, 'data-x': '1', hidden: false, title: null }, 'hi', [null, 'there', false], 5);
  assert.equal(n.className, 'a b');
  assert.equal(n.textContent, 'hithere5');
  assert.equal(n.getAttribute('data-x'), '1');
  assert.equal(n.hidden, false);
  n.click();
  assert.equal(clicked, 1);
});

test('el adds typography class for h2/label unless one is given', () => {
  assert.ok(el('h2', {}, 'x').classList.contains('t-title'));
  assert.ok(el('label', {}, 'x').classList.contains('t-caption'));
  assert.ok(!el('h2', { class: 't-display' }, 'x').classList.contains('t-title'));
});

test('el treats text children as text, never markup', () => {
  const n = el('div', {}, '<img src=x onerror=alert(1)>');
  assert.equal(n.children.length, 0);
  assert.equal(n.textContent, '<img src=x onerror=alert(1)>');
});

test('pageHead and field build the expected structure', () => {
  assert.equal(pageHead('Library').querySelector('h1').textContent, 'Library');
  assert.equal(pageHead('Library').querySelector('.muted'), null);
  assert.equal(pageHead('Library', 'sub').querySelector('.muted').textContent, 'sub');
  const f = field('Title', el('input'));
  assert.equal(f.querySelector('label').textContent, 'Title');
  assert.equal(f.children.length, 2);
});

test('toast shows, auto-hides and runs the action', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const box = document.getElementById('toast');
  toast('hello');
  assert.equal(box.hidden, false);
  assert.equal(box.textContent, 'hello');
  t.mock.timers.tick(3001);
  assert.equal(box.hidden, true);

  let ran = 0;
  toast('undo?', { label: 'Undo', run: () => { ran += 1; } });
  t.mock.timers.tick(3500);
  assert.equal(box.hidden, false, 'actionable toast lingers 6 s');
  box.querySelector('button').click();
  assert.equal(ran, 1);
  assert.equal(box.hidden, true);
});
