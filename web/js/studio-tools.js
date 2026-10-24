import { createRhythmCard } from './rhythm.js';
import { createHarmonicsCard } from './harmonics.js';
import { createListenCard } from './listen.js';

function mountCards(panel, cards) {
  panel.replaceChildren(...cards.map((c) => c.node));
  return () => { for (const c of cards) c.dispose(); };
}

export const mountRhythm = (panel, env = {}) => mountCards(panel, [createRhythmCard(env)]);

export const mountListen = (panel, env = {}) => mountCards(panel, [createListenCard(env.listen)]);

export const mountChordophones = (panel, env = {}) => mountCards(panel, [createHarmonicsCard(env.harmonics)]);
