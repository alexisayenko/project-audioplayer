import { el } from './dom.js';
import { store } from './store.js';
import { splitInput } from './tag-input.js';
import { tagGroups, tagLabel, tagText, tagSearchText } from './tagname.js';

const same = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export function tagEditor({ tags = [], suggested = [] } = {}) {
  let current = [...tags];
  const input = el('input', { type: 'text', placeholder: 'Type a tag (plain or key:value), Enter or comma to add', enterKeyHint: 'done', autocomplete: 'off' });
  const chosen = el('div', { class: 'chips' });
  const sugBox = el('div', { class: 'chip-group' });
  const pool = el('div', { class: 'chip-groups tag-pool' });
  const node = el('div', { class: 'tag-editor' }, input, chosen, sugBox, pool);

  const has = (t) => current.some((x) => same(x, t));
  const toggle = (t) => {
    current = has(t) ? current.filter((x) => !same(x, t)) : [...current, t];
    render();
  };
  function add(raw) {
    const { tags: added, rest } = splitInput(raw);
    for (const t of added) if (!has(t)) current.push(t);
    input.value = rest;
    render();
  }

  function chip(t, count) {
    return el('button', { type: 'button', class: `chip${has(t) ? ' on' : ''}`, title: t, 'aria-pressed': String(has(t)), onclick: () => toggle(t) },
      tagLabel(t), count != null ? el('small', {}, count) : null);
  }

  function render() {
    const q = input.value.trim().toLocaleLowerCase();
    chosen.replaceChildren(...current.map((t) => el('span', { class: 'chip on', title: t }, tagText(t),
      el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${t}`, onclick: () => toggle(t) }, '×'))));
    const sug = suggested;
    sugBox.hidden = !sug.length;
    sugBox.replaceChildren(...(sug.length ? [el('span', { class: 'group-name' }, 'Suggested'), ...sug.map((t) => chip(t))] : []));
    const shown = store.tags.filter((t) => !q || tagSearchText(t.tag).toLocaleLowerCase().includes(q));
    pool.replaceChildren(...tagGroups(shown).map((g) => el('div', { class: 'chip-group' },
      el('span', { class: 'group-name' }, g.name),
      ...[...g.tags].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).map((t) => chip(t.tag, t.count)))));
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
  });
  input.addEventListener('input', render);
  render();

  return { node, getTags() { add(input.value); return [...current]; } };
}
