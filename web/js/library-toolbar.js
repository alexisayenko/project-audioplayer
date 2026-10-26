import { store } from './store.js';
import { el, plural } from './dom.js';
import { tagLabel, categoryTags } from './tagname.js';
import { prefs, visibleSongs, unsetKey, unsetCount, unsetLabel } from './library-data.js';

/** `src` lets another list reuse the sheet: { values: [{tag, count}], sel: Set, summary(selected, total) } (no "not set" pill, labels as given). */
export function openFilterSheet(cat, opener, onApply, src = null) {
  const dlg = document.getElementById('filter-sheet');
  const sel = src ? src.sel : prefs.sel;
  const keyOf = (t) => (src ? t : t.toLocaleLowerCase());
  const labelOf = (t) => (src ? t : tagLabel(t));
  const values = src ? src.values : categoryTags(store.tags, cat.id);
  const sub = el('p', { class: 't-caption muted' });
  const pills = el('div', { class: 'pills' });
  const uKey = src ? null : unsetKey(cat.id);
  const uCount = src ? 0 : unsetCount(cat.id);
  const keys = [...values.map((v) => keyOf(v.tag)), ...(uKey ? [uKey] : [])];
  const mine = () => keys.filter((k) => sel.has(k)).length;
  const refresh = () => {
    const n = src ? 0 : visibleSongs().length;
    sub.textContent = src ? src.summary(mine(), values.length) : `${values.length} in your library · ${mine()} selected · ${n} ${plural(n, 'song', 'songs')}`;
    for (const b of pills.children) {
      const on = sel.has(b.dataset.key);
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
    }
  };
  const apply = () => {
    refresh();
    onApply();
  };
  const toggle = (key) => {
    if (sel.has(key)) sel.delete(key);
    else sel.add(key);
    apply();
  };
  const unsetPill = uKey && (uCount || prefs.sel.has(uKey)) ? [el('button', {
    class: 'chip t-subhead unset', type: 'button', title: unsetLabel(cat.id), 'aria-label': unsetLabel(cat.id),
    'data-key': uKey, 'aria-pressed': 'false', onclick: () => toggle(uKey),
  }, el('span', { class: 'unset-ico', 'aria-hidden': 'true' }), 'not set', el('small', { class: 't-caption' }, uCount))] : [];
  pills.append(...unsetPill, ...values.map((v) => {
    const key = keyOf(v.tag);
    return el('button', {
      class: 'chip t-subhead', type: 'button', title: v.tag, 'data-key': key, 'aria-pressed': 'false',
      onclick: () => toggle(key),
    }, labelOf(v.tag), el('small', { class: 't-caption' }, v.count));
  }));
  const clear = el('button', { class: 'link-btn t-subhead strong', type: 'button', onclick: () => {
    for (const k of keys) sel.delete(k);
    apply();
  } }, 'Clear');
  dlg.replaceChildren(
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-head' },
      el('div', {}, el('h2', { id: 'sheet-title', class: 't-title' }, cat.name), sub),
      clear),
    pills);
  refresh();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  pills.firstElementChild?.focus();
  dlg.addEventListener('close', () => {
    const back = opener.isConnected ? opener : document.querySelector(`.cat-chip[data-cat="${cat.id}"]`);
    back?.focus();
  }, { once: true });
}
