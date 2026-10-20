import { player } from './player.js';
import { icon } from './icons.js';
import { openShareDialog } from './lazy-ui.js';

const $ = (id) => document.getElementById(id);

export function initShare() {
  const buttons = ['p-share', 'viz-share'].map($).filter(Boolean);
  for (const b of buttons) {
    b.replaceChildren(icon('share', 'nav'));
    b.addEventListener('click', (e) => openShareDialog(player.current, e.currentTarget));
  }
  const sync = () => { for (const b of buttons) b.hidden = !player.current; };
  player.onChange(sync);
  sync();
}
