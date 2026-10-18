import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const g = await import('./guest.js');

test('signed in: every capability is available and no banner is built', () => {
  g.clearGuest();
  for (const cap of ['edit', 'add', 'remove', 'download', 'fetch', 'identify', 'tags', 'autodl', 'fill', 'drafts', 'play', 'queue']) assert.equal(g.can(cap), true, cap);
  assert.equal(g.isGuest(), false);
  assert.equal(g.banner(() => {}), null);
  assert.equal(g.streamable(), true);
});

test('guest: write capabilities are off, read ones stay on, unknown ones are denied', () => {
  g.setGuest({ guest: true, audio: true, owner_label: 'Alex' });
  for (const cap of ['edit', 'add', 'remove', 'download', 'fetch', 'identify', 'tags', 'autodl', 'fill', 'drafts']) assert.equal(g.can(cap), false, cap);
  for (const cap of ['play', 'queue', 'filter', 'search', 'sort', 'card']) assert.equal(g.can(cap), true, cap);
  assert.equal(g.can('something-new'), false);
  assert.equal(g.isGuest(), true);
  assert.equal(g.streamable(), true);
  g.clearGuest();
});

test('guest without audio is not streamable and a missing label defaults to Alex', () => {
  g.setGuest({ guest: true, audio: false });
  assert.equal(g.streamable(), false);
  assert.equal(g.ownerLabel(), 'Alex');
  g.clearGuest();
  assert.equal(g.streamable(), true);
});

test('banner names the owner, offers Sign in and replaces itself on sync', () => {
  g.setGuest({ guest: true, audio: true, owner_label: 'Alex' });
  let clicks = 0;
  const node = g.banner(() => { clicks += 1; });
  assert.equal(node.id, 'guest-banner');
  assert.match(node.textContent, /Viewing Alex's library \(read-only\)\. Sign in to build your own/);
  const btn = node.querySelector('button');
  assert.equal(btn.textContent, 'Sign in');
  btn.click();
  assert.equal(clicks, 1);
  const stage = document.createElement('div');
  const first = document.createElement('main');
  stage.append(first);
  g.syncBanner(stage, first, () => {});
  g.syncBanner(stage, stage.firstChild, () => {});
  assert.equal(stage.querySelectorAll('#guest-banner').length, 1);
  g.clearGuest();
  assert.equal(g.syncBanner(stage, stage.firstChild, () => {}), null);
  assert.equal(stage.querySelectorAll('#guest-banner').length, 0);
});
