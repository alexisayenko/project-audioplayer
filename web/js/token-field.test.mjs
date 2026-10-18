import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent } from './test-dom.mjs';

installDom();
const { tokenGroup } = await import('./token-field.js');

const pills = (f) => f.querySelectorAll('.token-pill').map((p) => p.querySelector('.token-text').textContent);
const entry = (f) => f.querySelector('.token-entry');
const typeIn = (f, v) => { entry(f).value = v; entry(f).dispatchEvent(makeEvent('input')); };
function mount() {
  const g = tokenGroup();
  const title = g.field('title', 'Song A - Song B');
  const artist = g.field('artists', 'Band X');
  const remixer = g.field('by', '');
  const host = document.createElement('div');
  host.append(title, artist, remixer);
  document.body.append(host);
  return { g, title, artist, remixer, host };
}

test('value is split into pills; reading value round-trips', () => {
  const { title, artist, remixer } = mount();
  assert.deepEqual(pills(title), ['Song A', 'Song B']);
  assert.deepEqual(pills(artist), ['Band X']);
  assert.deepEqual(pills(remixer), []);
  assert.equal(title.value, 'Song A - Song B');
  assert.equal(artist.value, 'Band X');
});

test('setting value replaces pills and clears the pending text', () => {
  const { artist } = mount();
  entry(artist).value = 'half typed';
  artist.value = 'New - Other';
  assert.deepEqual(pills(artist), ['New', 'Other']);
  assert.equal(entry(artist).value, '');
  artist.value = null;
  assert.deepEqual(pills(artist), []);
});

test('typing a separator commits the finished token as a pill and fires input', () => {
  const { artist } = mount();
  let fired = 0;
  artist.addEventListener('input', () => { fired += 1; });
  typeIn(artist, 'Second - ');
  assert.deepEqual(pills(artist), ['Band X', 'Second']);
  assert.equal(entry(artist).value, '');
  typeIn(artist, 'plain');
  assert.deepEqual(pills(artist), ['Band X', 'Second'], 'no separator, no pill yet');
  entry(artist).dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
  assert.deepEqual(pills(artist), ['Band X', 'Second', 'plain']);
  assert.ok(fired >= 1);
  assert.equal(artist.value, 'Band X - Second - plain');
});

test('blur commits pending text', () => {
  const { remixer } = mount();
  entry(remixer).value = 'DJ Z';
  entry(remixer).dispatchEvent(makeEvent('blur'));
  assert.deepEqual(pills(remixer), ['DJ Z']);
});

test('the remove button drops a pill and fires input', () => {
  const { title } = mount();
  let fired = 0;
  title.addEventListener('input', () => { fired += 1; });
  title.querySelectorAll('.token-pill')[0].querySelectorAll('button')[1].click();
  assert.deepEqual(pills(title), ['Song B']);
  assert.equal(fired, 1);
});

test('pencil opens a menu; Remove and Move to X work; menu closes on selection', () => {
  const { title, artist } = mount();
  const pencil = title.querySelector('.token-pill').querySelector('button');
  pencil.click();
  assert.equal(title.querySelectorAll('.token-menu').length, 1);
  assert.equal(pencil.getAttribute('aria-expanded'), 'true');
  const labels = title.querySelector('.token-menu').querySelectorAll('button').map((b) => b.textContent);
  assert.deepEqual(labels, ['Edit text', 'Move to Artists', 'Move to Remix by', 'Remove']);
  title.querySelector('.token-menu').querySelectorAll('button')[1].click();
  assert.deepEqual(pills(title), ['Song B']);
  assert.deepEqual(pills(artist), ['Band X', 'Song A']);
  assert.equal(title.querySelectorAll('.token-menu').length, 0);
});

test('the last title token cannot be moved away (Move is disabled, moveTo refuses)', () => {
  const g = tokenGroup();
  const title = g.field('title', 'Only');
  const artist = g.field('artists', '');
  document.body.append(title, artist);
  title.querySelector('.token-pill').querySelector('button').click();
  const move = title.querySelector('.token-menu').querySelectorAll('button')[1];
  assert.equal(move.disabled, true);
  title.moveTo(0, 'artists');
  assert.deepEqual(pills(title), ['Only']);
  assert.deepEqual(pills(artist), []);
});

test('the menu toggles on a second pencil click and closes with Escape', () => {
  const { title } = mount();
  const pencil = title.querySelector('.token-pill').querySelector('button');
  pencil.click();
  pencil.click();
  assert.equal(title.querySelectorAll('.token-menu').length, 0);
  pencil.click();
  title.querySelector('.token-menu').dispatchEvent(makeEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(title.querySelectorAll('.token-menu').length, 0);
});

test('Edit text: Enter saves the new text, Escape discards', () => {
  const { artist } = mount();
  const open = () => {
    artist.querySelector('.token-pill').querySelector('button').click();
    artist.querySelector('.token-menu').querySelector('button').click();
    return artist.querySelector('.token-edit');
  };
  let edit = open();
  edit.value = 'Renamed';
  edit.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
  assert.deepEqual(pills(artist), ['Renamed']);
  edit = open();
  edit.value = 'Ignored';
  edit.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));
  assert.deepEqual(pills(artist), ['Renamed']);
});

test('acceptDrop reorders within a field and moves across fields', () => {
  const { title, artist } = mount();
  title.acceptDrop('title', 0, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(pills(title), ['Song B', 'Song A']);
  title.acceptDrop('title', 0, 0);
  assert.deepEqual(pills(title), ['Song B', 'Song A'], 'dropping onto itself changes nothing');
  artist.acceptDrop('title', 0, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(pills(title), ['Song A']);
  assert.deepEqual(pills(artist), ['Band X', 'Song B']);
  artist.acceptDrop('nonsense', 0, 0);
  assert.deepEqual(pills(artist), ['Band X', 'Song B']);
});

test('drop event with a foreign payload is ignored', () => {
  const { title } = mount();
  const e = makeEvent('drop', { dataTransfer: { types: ['text/plain'], getData: () => '' } });
  title.dispatchEvent(e);
  assert.equal(e.defaultPrevented, false);
});

test('drop event with the token mime moves the dragged pill', () => {
  const { title, artist } = mount();
  const payload = JSON.stringify({ kind: 'title', index: 1 });
  const e = makeEvent('drop', { bubbles: true, target: artist, dataTransfer: { types: ['application/x-electrophone-token'], getData: () => payload } });
  artist.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(pills(title), ['Song A']);
  assert.deepEqual(pills(artist), ['Band X', 'Song B']);
});

test('touch long-press drag moves a pill into another field; an early move cancels the drag', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  document.elementFromPoint = (x) => (x > 500 ? document.getElementById('drop-target') : null);
  const g = tokenGroup();
  const title = g.field('title', 'Song A - Song B');
  const artist = g.field('artists', 'Band X');
  artist.setAttribute('id', 'drop-target');
  document.body.append(title, artist);
  const pill = title.querySelectorAll('.token-pill')[1];
  const ev = (type, x, y) => makeEvent(type, { clientX: x, clientY: y, pointerType: 'touch', button: 0 });

  pill.dispatchEvent(ev('pointerdown', 10, 10));
  document.dispatchEvent(ev('pointermove', 80, 80));
  t.mock.timers.tick(300);
  assert.equal(pill.classList.contains('dragging'), false, 'moved before the long press: no drag');

  const pill2 = title.querySelectorAll('.token-pill')[1];
  pill2.dispatchEvent(ev('pointerdown', 10, 10));
  t.mock.timers.tick(300);
  assert.ok(pill2.classList.contains('dragging'));
  assert.ok(document.body.querySelector('.token-drag-clone'));
  document.dispatchEvent(ev('pointermove', 600, 20));
  document.dispatchEvent(ev('pointerup', 600, 20));
  assert.equal(document.body.querySelector('.token-drag-clone'), null);
  assert.deepEqual(pills(title), ['Song A']);
  assert.deepEqual(pills(artist), ['Band X', 'Song B']);
});

test('mouse pointer never starts the touch drag', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { title } = mount();
  const pill = title.querySelector('.token-pill');
  pill.dispatchEvent(makeEvent('pointerdown', { clientX: 1, clientY: 1, pointerType: 'mouse', button: 0 }));
  t.mock.timers.tick(500);
  assert.equal(pill.classList.contains('dragging'), false);
});

test('featured and by fields use the same pill rules and offer moves to each other', () => {
  const g = tokenGroup();
  const artists = g.field('artists', 'A - B');
  const featured = g.field('featured', 'C');
  const by = g.field('by', 'D');
  document.body.append(artists, featured, by);
  assert.deepEqual(pills(featured), ['C']);
  assert.equal(featured.getAttribute('aria-label'), 'Featuring');
  assert.equal(by.getAttribute('aria-label'), 'Remix by');
  featured.querySelector('.token-pill').querySelector('button').click();
  const labels = featured.querySelector('.token-menu').querySelectorAll('button').map((b) => b.textContent);
  assert.deepEqual(labels, ['Edit text', 'Move to Artists', 'Move to Remix by', 'Remove']);
  featured.querySelector('.token-menu').querySelectorAll('button')[2].click();
  assert.deepEqual(pills(by), ['D', 'C']);
  assert.deepEqual(pills(featured), []);
});
