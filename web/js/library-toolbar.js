import { store } from './store.js';
import { el, plural } from './dom.js';
import { tagLabel, categoryTags } from './tagname.js';
import { prefs, visibleSongs, unsetKey, unsetCount, unsetLabel } from './library-data.js';

export function openFilterSheet(cat, opener, onApply) {
  const dlg = document.getElementById('filter-sheet');
  const values = categoryTags(store.tags, cat.id);
  const sub = el('p', { class: 't-caption muted' });
  const pills = el('div', { class: 'pills' });
  const uKey = unsetKey(cat.id);
  const uCount = unsetCount(cat.id);
  const keys = [...values.map((v) => v.tag.toLocaleLowerCase()), ...(uKey ? [uKey] : [])];
  const mine = () => keys.filter((k) => prefs.sel.has(k)).length;
  const refresh = () => {
    const n = visibleSongs().length;
    sub.textContent = `${values.length} in your library · ${mine()} selected · ${n} ${plural(n, 'song', 'songs')}`;
    for (const b of pills.children) {
      const on = prefs.sel.has(b.dataset.key);
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
    }
  };
  const apply = () => {
    refresh();
    onApply();
  };
  const toggle = (key) => {
    if (prefs.sel.has(key)) prefs.sel.delete(key);
    else prefs.sel.add(key);
    apply();
  };
  const unsetPill = uKey && (uCount || prefs.sel.has(uKey)) ? [el('button', {
    class: 'chip t-subhead unset', type: 'button', title: unsetLabel(cat.id), 'aria-label': unsetLabel(cat.id),
    'data-key': uKey, 'aria-pressed': 'false', onclick: () => toggle(uKey),
  }, el('span', { class: 'unset-ico', 'aria-hidden': 'true' }), 'not set', el('small', { class: 't-caption' }, uCount))] : [];
  pills.append(...unsetPill, ...values.map((v) => {
    const key = v.tag.toLocaleLowerCase();
    return el('button', {
      class: 'chip t-subhead', type: 'button', title: v.tag, 'data-key': key, 'aria-pressed': 'false',
      onclick: () => toggle(key),
    }, tagLabel(v.tag), el('small', { class: 't-caption' }, v.count));
  }));
  const clear = el('button', { class: 'link-btn t-subhead strong', type: 'button', onclick: () => {
    for (const k of keys) prefs.sel.delete(k);
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
