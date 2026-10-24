import { el } from './dom.js';
import { icon } from './icons.js';

export function searchBox({ placeholder, label = 'Search', value = '', onChange, onKeydown }) {
  const input = el('input', { type: 'search', placeholder, value, 'aria-label': label });
  const clearBtn = el('button', { class: 'icon search-clear', type: 'button', hidden: !value, 'aria-label': 'Clear search', title: 'Clear search' }, icon('clear', 'inline'));
  const node = el('label', { class: 'search' }, icon('search', 'action'), input, clearBtn);

  function paintClear() { clearBtn.hidden = !input.value; }

  function clear() {
    input.value = '';
    paintClear();
    onChange('');
    input.focus();
  }

  input.addEventListener('input', () => { paintClear(); onChange(input.value); });
  input.addEventListener('keydown', (e) => {
    onKeydown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && input.value) { e.preventDefault(); clear(); }
  });
  clearBtn.addEventListener('click', clear);

  return { node, input, clear, paintClear };
}
