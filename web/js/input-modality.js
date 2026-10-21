const KEYBOARD_KEYS = new Set(['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

export function initInputModality(doc = document) {
  const root = doc.documentElement;
  const set = (mode) => { if (root.dataset.input !== mode) root.dataset.input = mode; };
  set('pointer');
  doc.addEventListener('pointerdown', () => set('pointer'), true);
  doc.addEventListener('mousedown', () => set('pointer'), true);
  doc.addEventListener('touchstart', () => set('pointer'), { capture: true, passive: true });
  doc.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && KEYBOARD_KEYS.has(e.key)) set('keyboard');
  }, true);
}

initInputModality();
