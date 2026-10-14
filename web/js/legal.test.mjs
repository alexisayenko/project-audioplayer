import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage, stubFetch, flush } from './test-dom.mjs';

await installPage();
const { NOTE, buildLegal, contactHref, legalVisible, syncLegal, loadLegal } = await import('./legal.js');

const text = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join('');

test('without a contact the fixed note is one plain string', () => {
  assert.deepEqual(buildLegal(), [NOTE]);
  assert.deepEqual(buildLegal(NOTE, 'javascript:alert(1)'), [NOTE]);
});

test('an email becomes a mailto link, ending the removal sentence', () => {
  const parts = buildLegal(NOTE, ' legal@example.com ');
  assert.equal(text(parts), NOTE.replace('contact the owner.', 'contact legal@example.com.'));
  assert.equal(parts[1].getAttribute('href'), 'mailto:legal@example.com');
});

test('an https URL opens safely in a new tab', () => {
  const a = buildLegal(NOTE, 'https://example.com/takedown')[1];
  assert.equal(a.getAttribute('href'), 'https://example.com/takedown');
  assert.match(a.getAttribute('rel'), /noopener/);
  assert.equal(a.getAttribute('target'), '_blank');
});

test('unsafe contacts are rejected', () => {
  for (const bad of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', 'mailto:a@b.co', 'https://x.com/"onclick=1', '', null, 5]) {
    assert.equal(contactHref(bad), null, String(bad));
  }
});

test('visible in guest view and Settings, never in the full-screen visualizer', () => {
  assert.equal(legalVisible({ guest: true, route: 'library' }), true);
  assert.equal(legalVisible({ guest: false, route: 'settings' }), true);
  assert.equal(legalVisible({ guest: false, route: 'library' }), false);
  assert.equal(legalVisible({ guest: true, route: 'settings', vizFull: true }), false);
});

test('syncLegal renders into the footer and toggles hidden', () => {
  const footer = document.createElement('footer');
  syncLegal(footer, { guest: true, route: 'library' });
  assert.equal(footer.hidden, false);
  assert.equal(footer.textContent, NOTE);
  syncLegal(footer, { guest: true, route: 'library', vizFull: true });
  assert.equal(footer.hidden, true);
  syncLegal(footer, { guest: false, route: 'settings' });
  assert.equal(footer.hidden, false);
});

test('loadLegal adds the contact link; a failed fetch keeps the built-in text', async () => {
  const footer = document.createElement('footer');
  stubFetch(() => ({ body: { note: NOTE, contact: 'legal@example.com' } }));
  await loadLegal(footer, () => ({ guest: true }));
  await flush();
  assert.ok(footer.textContent.endsWith('contact legal@example.com.'));
  const again = document.createElement('footer');
  stubFetch(() => ({ status: 500, body: {} }));
  await loadLegal(again, () => ({ guest: true }));
  assert.ok(again.textContent.startsWith('A private personal library.'));
});
