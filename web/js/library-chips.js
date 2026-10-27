import { store } from './store.js';
import { el, plural } from './dom.js';
import { isGuest } from './guest.js';
import { openFilterSheet } from './lazy-ui.js';
import { tagLabel, categoryOf, CATEGORIES } from './tagname.js';
import { prefs, selectedIn, isUnsetKey, unsetCount, hasListening, neverCount } from './library-data.js';
import { cachedReferences, referenceSongIds, ROLES, roleLabel } from './references.js';

function refsControls(onChange) {
  if (isGuest() || (!cachedReferences() && !prefs.refs)) return [];
  const have = new Set(store.songs.map((s) => s.id));
  const count = [...referenceSongIds()].filter((id) => have.has(id)).length;
  if (!count && !prefs.refs) return [];
  const on = !!prefs.refs;
  const chip = el('button', {
    class: `cat-chip${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-cat': 'refs',
    title: 'Songs that are reference tracks for a genre',
    onclick: () => { prefs.refs = on ? '' : 'any'; onChange(); },
  }, 'Reference tracks', el('small', { class: 't-caption' }, count));
  if (!on) return [chip];
  const role = el('select', { class: 'refs-role', 'aria-label': 'Reference role', onchange: (e) => { prefs.refs = e.target.value; onChange(); } },
    el('option', { value: 'any', selected: prefs.refs === 'any' }, 'All roles'),
    ...ROLES.map((r) => el('option', { value: r, selected: prefs.refs === r }, roleLabel(r))));
  return [chip, role];
}

export function chipNodes(onChange) {
  for (const t of prefs.sel) if (!isUnsetKey(t) && !store.tags.some((x) => x.tag.toLocaleLowerCase() === t)) prefs.sel.delete(t);
  const never = hasListening() ? neverCount() : 0;
  const neverBtn = hasListening() ? el('button', {
    class: `cat-chip${prefs.never ? ' on' : ''}`, type: 'button', 'aria-pressed': String(prefs.never), 'data-cat': 'never', disabled: !never && !prefs.never,
    onclick: () => { prefs.never = !prefs.never; onChange(); },
  }, 'Never listened', el('small', { class: 't-caption' }, never)) : null;
  return [
    ...CATEGORIES.map((c) => {
      const values = store.tags.filter((t) => categoryOf(t.tag) === c.id).length;
      const n = selectedIn(c.id);
      const b = el('button', {
        class: `cat-chip${n ? ' on' : ''}`, type: 'button', disabled: !values && !unsetCount(c.id),
        'aria-haspopup': 'dialog', 'data-cat': c.id,
        onclick: () => openFilterSheet(c, b, onChange),
      }, c.name, el('small', { class: 't-caption' }, n || values));
      b.setAttribute('aria-label', n ? `${c.name}, ${n} selected` : `${c.name}, ${values}`);
      return b;
    }),
    ...(neverBtn ? [neverBtn] : []),
    ...refsControls(onChange),
  ];
}

function selectedNames() {
  return [...prefs.sel].map((k) => (isUnsetKey(k) ? { unset: categoryOf(k) } : store.tags.find((t) => t.tag.toLocaleLowerCase() === k))).filter(Boolean).slice(0, 3)
    .map((t) => (t.unset ? `${CATEGORIES.find((c) => c.id === t.unset).name}: not set` : tagLabel(t.tag)));
}

export function matchSummary(count) {
  const names = prefs.sel.size ? ` · ${selectedNames().join(', ')}` : '';
  return `${count} ${plural(count, 'song matches', 'songs match')}${names}`;
}
