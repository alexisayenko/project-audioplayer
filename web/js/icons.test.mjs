import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { ICONS, icon } = await import('./icons.js');
const { LABELS, serviceIcon, serviceIcons } = await import('./service-icons.js');

test('every icon renders an aria-hidden svg of the requested size', () => {
  for (const name of Object.keys(ICONS)) {
    const s = icon(name, 16);
    assert.equal(s.localName, 'svg');
    assert.equal(s.getAttribute('width'), '16');
    assert.equal(s.getAttribute('aria-hidden'), 'true');
    assert.ok(s.innerHTML.length > 0, name);
    assert.ok(s.getAttribute('fill') === 'currentColor' || s.getAttribute('stroke') === 'currentColor', name);
  }
});

test('unknown icon throws rather than rendering nothing silently', () => {
  assert.throws(() => icon('no-such-icon'));
});

test('serviceIcon falls back to the external glyph', () => {
  assert.ok(serviceIcon('youtube').innerHTML.includes('<path'));
  assert.equal(serviceIcon('nope').innerHTML.includes('M15 3h6v6'), true);
  assert.ok(serviceIcon('apple').innerHTML.includes('<path'));
  assert.equal(serviceIcon('youtube', { size: 30 }).getAttribute('width'), '30');
});

test('serviceIcons row: links only when on with a url, pulse only when busy and not inert', () => {
  const row = serviceIcons();
  assert.equal(row.node.children.length, Object.keys(LABELS).length);
  assert.ok(row.node.children.every((c) => c.localName === 'span' && c.getAttribute('role') === 'img'));
  row.setState({ youtube: { on: true, url: 'https://y/1' }, spotify: { on: true } });
  const yt = row.node.querySelector('.svc-youtube');
  assert.equal(yt.localName, 'a');
  assert.equal(yt.getAttribute('href'), 'https://y/1');
  assert.equal(yt.getAttribute('rel'), 'noopener');
  assert.equal(row.node.querySelector('.svc-spotify').localName, 'span');
  assert.ok(row.node.querySelector('.svc-spotify').classList.contains('on'));
  row.setBusy(true);
  assert.ok(row.node.querySelectorAll('.pulse').length >= 1);
  row.reset();
  assert.equal(row.node.querySelectorAll('.on').length, 0);
  assert.equal(row.node.querySelectorAll('.pulse').length, 0);
  row.setState(null);
  assert.equal(row.node.children.length, Object.keys(LABELS).length);
});

test('size is a token class or a numeric width, and stroke is set only here', () => {
  const tok = icon('check', 'action');
  assert.equal(tok.getAttribute('class'), 'ic ic-action');
  assert.equal(tok.getAttribute('width'), null);
  assert.equal(icon('check').getAttribute('class'), 'ic ic-nav');
  assert.equal(icon('check', 14).getAttribute('height'), '14');
  assert.equal(icon('play').getAttribute('stroke-width'), '1.8');
});

test('fill only for play, pause, prev, next and more; everything else is stroked', () => {
  for (const name of Object.keys(ICONS)) {
    const filled = ['play', 'pause', 'prev', 'next', 'more'].includes(name);
    assert.equal(icon(name).getAttribute('fill'), filled ? 'currentColor' : 'none', name);
  }
});

test('shuffle, repeat and repeat-one icons are well-formed stroke icons', () => {
  for (const name of ['shuffle', 'repeat', 'repeatOne']) {
    const s = icon(name, 'nav');
    assert.equal(s.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(s.getAttribute('fill'), 'none');
    assert.equal(s.getAttribute('stroke'), 'currentColor');
    assert.ok(!/#[0-9a-f]{3,6}|rgb|<text/i.test(s.innerHTML), name);
  }
  assert.ok(ICONS.repeatOne.d.startsWith(ICONS.repeat.d));
  assert.ok(ICONS.repeatOne.d.length > ICONS.repeat.d.length);
});
