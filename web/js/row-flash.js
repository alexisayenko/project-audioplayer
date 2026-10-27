import { ROW_FLASH_MS } from './constants.js';
import { scrollTarget } from './reveal.js';

let flashId = null;
let flashTimer;

export const flashedId = () => flashId;

export function clearFlash() {
  clearTimeout(flashTimer);
  flashId = null;
}

export function scrollToRow(list, id) {
  const row = list.querySelector(`li.song[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const r = row.getBoundingClientRect();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({
    top: scrollTarget({ rowTop: r.top, rowHeight: r.height, scrollY: window.scrollY, viewportH: window.innerHeight, docH: document.documentElement.scrollHeight }),
    behavior: reduce ? 'auto' : 'smooth',
  });
  flashId = id;
  row.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashId = null;
    list.querySelector('li.song.flash')?.classList.remove('flash');
  }, ROW_FLASH_MS);
}
