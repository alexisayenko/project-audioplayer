import { el, field } from './dom.js';
import { cleanTitleEx } from './title-clean.js';
import { splitTokens } from './tokens.js';

export function titleCleaner({ f, isAdd, initial, first, emit }) {
  const titleField = field('Title', f.title);
  const cleaned = el('p', { class: 't-caption muted', role: 'status', hidden: true });
  const moveHint = el('button', { class: 'link-btn t-caption', type: 'button', hidden: true });
  titleField.append(cleaned, moveHint);
  let before = null;
  let restoredRaw = null;
  const paintCleaned = (removed) => {
    cleaned.replaceChildren();
    cleaned.hidden = !removed.length;
    if (!removed.length) return;
    const undo = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Restore');
    undo.addEventListener('click', () => {
      restoredRaw = before;
      f.title.value = before;
      paintCleaned([]);
      emit();
    });
    cleaned.append(`Cleaned: removed ${removed.join(' ')} - `, undo);
  };
  const applyClean = () => {
    const now = f.title.value;
    if (now === restoredRaw) return;
    const r = cleanTitleEx(now);
    if (r.title === now) return;
    before = now;
    restoredRaw = null;
    f.title.value = r.title;
    paintCleaned(r.removed);
    emit();
  };
  const paintMove = () => {
    const parts = splitTokens(f.title.value);
    const have = splitTokens(f.artist.value).map((a) => a.toLowerCase());
    const show = parts.length > 1 && !have.includes(parts[0].toLowerCase());
    moveHint.hidden = !show;
    moveHint.textContent = show ? `Move "${parts[0]}" to Artist?` : '';
  };
  moveHint.addEventListener('click', () => f.title.moveTo(0, 'artist'));
  if (isAdd) {
    f.title.addEventListener('paste', () => setTimeout(applyClean));
    f.title.addEventListener('focusout', (e) => { if (!f.title.contains(e.relatedTarget)) applyClean(); });
    if (first.removed.length) { before = String(initial.title_raw ?? initial.title ?? ''); paintCleaned(first.removed); }
  }
  f.title.addEventListener('input', paintMove);
  f.artist.addEventListener('input', paintMove);
  paintMove();
  return {
    node: titleField,
    paintCleaned,
    get restoredRaw() { return restoredRaw; },
    clearRestored() { restoredRaw = null; },
  };
}
