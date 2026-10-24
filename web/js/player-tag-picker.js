import { store } from './store.js';
import { el, toast, plural } from './dom.js';
import { tagGroups, tagLabel } from './tagname.js';
import { dialogHead } from './edit-dialog.js';

function applyLabel(fresh, drop) {
  if (fresh) return `Add songs (${fresh} ${plural(fresh, 'tag', 'tags')})`;
  return drop ? 'Apply' : 'Add songs';
}

export function openTagPicker(player, currentTags) {
  const dlg = document.getElementById('edit-dialog');
  const chosen = new Set(currentTags().map((t) => t.toLocaleLowerCase()));
  const groups = tagGroups(store.tags);
  const apply = el('button', { type: 'button', class: 'btn primary glow' }, 'Add songs');
  const refresh = () => {
    const fresh = [...chosen].filter((c) => !currentTags().some((t) => t.toLocaleLowerCase() === c));
    const drop = currentTags().filter((t) => !chosen.has(t.toLocaleLowerCase()));
    apply.disabled = !fresh.length && !drop.length;
    apply.textContent = applyLabel(fresh.length, drop.length);
  };
  const chip = (t) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', title: t.tag },
      tagLabel(t.tag), el('small', {}, t.count));
    const sync = () => {
      const on = chosen.has(t.tag.toLocaleLowerCase());
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    };
    b.addEventListener('click', () => {
      const k = t.tag.toLocaleLowerCase();
      if (chosen.has(k)) chosen.delete(k); else chosen.add(k);
      sync();
      refresh();
    });
    sync();
    return b;
  };
  apply.addEventListener('click', () => {
    const fresh = store.tags.filter((t) => chosen.has(t.tag.toLocaleLowerCase()) && !currentTags().some((x) => x.toLocaleLowerCase() === t.tag.toLocaleLowerCase()));
    const drop = currentTags().filter((t) => !chosen.has(t.toLocaleLowerCase()));
    dlg.close();
    let removed = 0;
    for (const t of drop) removed += player.removeTag(t);
    let added = 0;
    if (fresh.length) added = player.addTags(fresh.map((t) => t.tag));
    const parts = [];
    if (fresh.length) parts.push(`Added ${added} ${added === 1 ? 'song' : 'songs'}`);
    if (drop.length) parts.push(`removed ${removed} ${removed === 1 ? 'song' : 'songs'}`);
    toast(parts.join(', ').replace(/^./, (c) => c.toUpperCase()));
  });
  dlg.replaceChildren(el('div', {},
    dialogHead('Add songs by tag', 'Songs with any picked tag are added to the end of the queue.', () => dlg.close()),
    groups.length ? el('div', { class: 'chip-groups' }, groups.map((g) => el('div', { class: 'chip-group' },
      el('span', { class: 'group-name' }, g.name),
      ...g.tags.map(chip)))) : el('p', { class: 'muted' }, 'No tags yet'),
    el('div', { class: 'row end' }, apply)));
  refresh();
  dlg.showModal();
}
