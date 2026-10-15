import { store } from './store.js';
import { el, plural } from './dom.js';
import { tagLabel, categoryOf, categoryTags } from './tagname.js';
import { prefs, visibleSongs, unsetKey, unsetCount, unsetLabel } from './library-data.js';

export function openFilterSheet(cat, opener, onApply) {
  const dlg = document.getElementById('filter-sheet');
  const values = categoryTags(store.tags, cat.id);
  const draft = new Set(prefs.sel);
  const result = el('button', { class: 'btn primary glow big', type: 'button' });
  const sub = el('p', { class: 't-caption muted' });
  const pills = el('div', { class: 'pills' });
  const uKey = unsetKey(cat.id);
  const uCount = unsetCount(cat.id);
  const mine = () => values.filter((v) => draft.has(v.tag.toLocaleLowerCase())).length + (uKey && draft.has(uKey) ? 1 : 0);
  const refresh = () => {
    const n = visibleSongs(draft).length;
    result.textContent = `Show ${n} ${plural(n, 'song', 'songs')}`;
    sub.textContent = `${values.length} in your library · ${mine()} selected`;
    for (const b of pills.children) {
      b.setAttribute('aria-pressed', String(draft.has(b.dataset.key)));
      b.classList.toggle('on', draft.has(b.dataset.key));
    }
  };
  const toggle = (key) => {
    if (draft.has(key)) draft.delete(key);
    else draft.add(key);
    refresh();
  };
  const unsetPill = uKey && (uCount || draft.has(uKey)) ? [el('button', {
    class: 'chip t-subhead unset', type: 'button', title: unsetLabel(cat.id), 'aria-label': unsetLabel(cat.id),
    'data-key': uKey, 'aria-pressed': 'false', onclick: () => toggle(uKey),
  }, el('span', { class: 'unset-ico', 'aria-hidden': 'true' }), 'not set', el('small', { class: 't-caption' }, uCount))] : [];
  pills.append(...unsetPill, ...values.map((v) => {
    const key = v.tag.toLocaleLowerCase();
    return el('button', {
      class: 'chip t-subhead', type: 'button', title: v.tag, 'data-key': key, 'aria-pressed': 'false',
      onclick: () => {
        if (draft.has(key)) draft.delete(key);
        else draft.add(key);
        refresh();
      },
    }, tagLabel(v.tag), el('small', { class: 't-caption' }, v.count));
  }));
  result.addEventListener('click', () => {
    for (const v of values) prefs.sel.delete(v.tag.toLocaleLowerCase());
    if (uKey) prefs.sel.delete(uKey);
    for (const k of draft) if (categoryOf(k) === cat.id) prefs.sel.add(k);
    dlg.close();
    onApply();
  });
  const clear = el('button', { class: 'link-btn t-subhead strong', type: 'button', onclick: () => {
    for (const v of values) draft.delete(v.tag.toLocaleLowerCase());
    if (uKey) draft.delete(uKey);
    refresh();
  } }, 'Clear');
  dlg.replaceChildren(
    el('span', { class: 'grab', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-head' },
      el('div', {}, el('h2', { id: 'sheet-title', class: 't-title' }, cat.name), sub),
      clear),
    pills,
    result);
  refresh();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  result.focus();
  dlg.addEventListener('close', () => opener.isConnected && opener.focus(), { once: true });
}
