import { el, field } from './dom.js';
import { cleanTitleEx } from './title-clean.js';
import { splitTokens, joinTokens } from './tokens.js';
import { parseCreditTitle } from './credit-title.js';

const lowered = (names) => names.map((n) => n.toLowerCase());

export function titleCleaner({ f, isAdd, initial, first, emit }) {
  const titleField = field('Title', f.title);
  const cleaned = el('p', { class: 't-caption muted', role: 'status', hidden: true });
  const moveHint = el('button', { class: 'link-btn t-caption', type: 'button', hidden: true });
  titleField.append(cleaned, moveHint);
  let before = null;
  let restoredRaw = null;
  let moved = { featured: [], withs: [] };
  const addNames = (field, names) => {
    const have = splitTokens(field.value);
    const fresh = names.filter((n) => !lowered(have).includes(n.toLowerCase()));
    if (fresh.length) field.value = joinTokens([...have, ...fresh]);
    return fresh;
  };
  const takeBack = () => {
    for (const [key, names] of Object.entries(moved)) {
      if (names.length) f[key].value = joinTokens(splitTokens(f[key].value).filter((n) => !lowered(names).includes(n.toLowerCase())));
    }
    moved = { featured: [], withs: [] };
  };
  const paintCleaned = (removed) => {
    cleaned.replaceChildren();
    cleaned.hidden = !removed.length;
    if (!removed.length) return;
    const undo = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Restore');
    undo.addEventListener('click', () => {
      restoredRaw = before;
      f.title.value = before;
      takeBack();
      paintCleaned([]);
      emit();
    });
    cleaned.append(`Cleaned: removed ${removed.join(' ')} - `, undo);
  };
  const applyClean = () => {
    const now = f.title.value;
    if (now === restoredRaw) return;
    const r = cleanTitleEx(now);
    const credit = parseCreditTitle('', r.title);
    const text = credit.removed.length ? credit.title : r.title;
    if (text === now) return;
    before = now;
    restoredRaw = null;
    takeBack();
    f.title.value = text;
    if (credit.removed.length) moved = { featured: addNames(f.featured, credit.featuredArtists), withs: addNames(f.withs, credit.withArtists) };
    paintCleaned([...r.removed, ...credit.removed]);
    emit();
  };
  const paintMove = () => {
    const parts = splitTokens(f.title.value);
    const have = splitTokens(f.artists.value).map((a) => a.toLowerCase());
    const show = parts.length > 1 && !have.includes(parts[0].toLowerCase());
    moveHint.hidden = !show;
    moveHint.textContent = show ? `Move "${parts[0]}" to Artists?` : '';
  };
  moveHint.addEventListener('click', () => f.title.moveTo(0, 'artists'));
  if (isAdd) {
    f.title.addEventListener('paste', () => setTimeout(applyClean));
    f.title.addEventListener('focusout', (e) => { if (!f.title.contains(e.relatedTarget)) applyClean(); });
    if (first.removed.length) { before = String(initial.title_raw ?? initial.title ?? ''); paintCleaned(first.removed); }
  }
  f.title.addEventListener('input', paintMove);
  f.artists.addEventListener('input', paintMove);
  paintMove();
  return {
    node: titleField,
    paintCleaned,
    get restoredRaw() { return restoredRaw; },
    clearRestored() { restoredRaw = null; },
  };
}
