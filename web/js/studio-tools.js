import { el } from './dom.js';
import { createMicCard } from './mic-tool.js';
import { createHarmonicsCard } from './harmonics.js';
import { createListenCard } from './listen.js';

export const TOOLS_NOTE = 'Temporary home for audio tools.';

function mountCards(panel, cards, note) {
  panel.replaceChildren(...(note ? [note] : []), ...cards.map((c) => c.node));
  return () => { for (const c of cards) c.dispose(); };
}

export const mountMic = (panel, env = {}) => mountCards(panel, [createMicCard(env)]);

export const mountListen = (panel, env = {}) => mountCards(panel, [createListenCard(env.listen)]);

export const mountChordophones =(panel, env = {}) => mountCards(panel, [createHarmonicsCard(env.harmonics)]);

export function mountTools(panel, env = {}) {
  const cards = [createMicCard(env), createHarmonicsCard(env.harmonics)];
  const note = env.standalone ? null : el('p', { class: 'stu-tools-note muted t-caption' }, TOOLS_NOTE);
  return mountCards(panel, cards, note);
}
