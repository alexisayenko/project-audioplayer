import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, makeEvent, flush } from './test-dom.mjs';

installDom({ ids: ['audio', 'mini-viz'] });
document.body.dataset.route = 'library';
const { lazyVisualizer } = await import('./viz-lazy.js');

function setup() {
  const audio = document.getElementById('audio');
  const button = document.getElementById('mini-viz');
  const log = { loads: 0, inits: 0, opens: 0 };
  const load = async () => {
    log.loads += 1;
    return { initVisualizer: () => { log.inits += 1; return { openFull: () => { log.opens += 1; }, full: { open: () => { log.opens += 1; } } }; } };
  };
  return { lazy: lazyVisualizer({ player: {}, load, audio, button }), audio, button, log };
}

test('WEB-118: nothing loads at start; the first song load or play loads the visualizer once', async () => {
  const { audio, log } = setup();
  await flush();
  assert.equal(log.loads, 0);
  audio.dispatchEvent(makeEvent('loadstart'));
  audio.dispatchEvent(makeEvent('play'));
  await flush();
  assert.deepEqual(log, { loads: 1, inits: 1, opens: 0 });
});

test('WEB-118: the visualizer button loads it and opens the full screen once', async () => {
  const { button, log } = setup();
  button.dispatchEvent(makeEvent('click'));
  button.dispatchEvent(makeEvent('click'));
  await flush();
  assert.deepEqual(log, { loads: 1, inits: 1, opens: 1 });
});

test('WEB-118: V on the Now playing page loads it and opens; V elsewhere does nothing', async () => {
  const { log } = setup();
  document.dispatchEvent(makeEvent('keydown', { key: 'v' }));
  await flush();
  assert.equal(log.loads, 0);
  document.body.dataset.route = 'playback';
  document.dispatchEvent(makeEvent('keydown', { key: 'v' }));
  await flush();
  assert.deepEqual(log, { loads: 1, inits: 1, opens: 1 });
  document.body.dataset.route = 'library';
});

test('WEB-118: a failed load can be retried by the next trigger', async () => {
  const audio = document.getElementById('audio');
  let n = 0;
  const lazy = lazyVisualizer({ player: {}, audio, button: null, load: async () => { n += 1; if (n === 1) throw new Error('offline'); return { initVisualizer: () => ({ full: { open() {} }, openFull() {} }) }; } });
  await lazy.ensure().catch(() => {});
  assert.equal(lazy.isReady(), false);
  await lazy.ensure();
  assert.equal(lazy.isReady(), true);
  assert.equal(n, 2);
});

test('WEB-118: the share link host opens the full screen through the lazy loader', async () => {
  const { lazy, log } = setup();
  await lazy.openFull();
  assert.equal(log.opens, 1);
});
