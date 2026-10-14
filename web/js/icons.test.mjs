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
  assert.equal(serviceIcon('nope').innerHTML.includes('M14 4h6v6'), true);
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
