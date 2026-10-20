import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './test-dom.mjs';

installDom();
const { lazyRoute } = await import('./lazy-route.js');

const mount = () => { const root = document.createElement('div'); document.body.append(root); return root; };

test('WEB-117: a lazy route shows the loading state, then renders the module and returns its cleanup', async () => {
  let gate;
  const load = () => new Promise((r) => { gate = () => r({ render: (root) => { root.textContent = 'page'; return () => { root.dataset.cleaned = '1'; }; } }); });
  const root = mount();
  const cleanup = lazyRoute(load, 'render')(root);
  assert.match(root.textContent, /Loading/);
  gate();
  await flush();
  assert.equal(root.textContent, 'page');
  cleanup();
  assert.equal(root.dataset.cleaned, '1');
});

test('WEB-117: leaving before the module arrives renders nothing', async () => {
  let gate;
  const root = mount();
  let rendered = 0;
  const cleanup = lazyRoute(() => new Promise((r) => { gate = () => r({ render: () => { rendered += 1; } }); }), 'render')(root);
  cleanup();
  gate();
  await flush();
  assert.equal(rendered, 0);
});

test('WEB-117: a load failure shows an inline message and Retry loads again', async () => {
  let n = 0;
  const load = async () => {
    n += 1;
    if (n === 1) throw new Error('offline');
    return { render: (root) => { root.textContent = 'page'; } };
  };
  const root = mount();
  lazyRoute(load, 'render')(root);
  await flush();
  assert.match(root.textContent, /could not be loaded/);
  root.querySelector('button').click();
  await flush();
  assert.equal(root.textContent, 'page');
  assert.equal(n, 2);
});
