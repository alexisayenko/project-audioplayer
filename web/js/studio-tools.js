import { el } from './dom.js';
import { createMicCard } from './mic-tool.js';

export const TOOLS_NOTE = 'Temporary home for audio tools.';

export function mountTools(panel, env = {}) {
  const cards = [createMicCard(env)];
  panel.replaceChildren(el('p', { class: 'stu-tools-note muted t-caption' }, TOOLS_NOTE), ...cards.map((c) => c.node));
  return () => { for (const c of cards) c.dispose(); };
}
