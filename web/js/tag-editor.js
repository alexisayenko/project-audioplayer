import { el } from './dom.js';
import { store } from './store.js';
import { splitInput } from './tag-input.js';
import { isHiddenTag, visibleTags, tagGroups, tagLabel, tagText, tagSearchText, withDecade, decadeRank } from './tagname.js';

const same = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export function tagEditor({ tags = [], suggested = [], year = null, onChange = null, hideNs = false } = {}) {
  const listeners = onChange ? [onChange] : [];
  const hidden = (t) => isHiddenTag(t) || (hideNs && /^(genre|country):/i.test(t));
  const shown = (list) => list.filter((t) => !hidden(t));
  const yearValue = () => (year && year.value !== '' ? Number(year.value) : null);
  let current = withDecade(tags, yearValue());
  let sug = shown(withDecade(suggested, yearValue()));
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
    for (const t of added) if (!isHiddenTag(t) && !has(t)) current.push(t);
    input.value = rest;
    render();
  }

  function chip(t, count) {
    return el('button', { type: 'button', class: `chip${has(t) ? ' on' : ''}`, title: t, 'aria-pressed': String(has(t)), onclick: () => toggle(t) },
      tagLabel(t), count != null ? el('small', {}, count) : null);
  }

  function render() {
    const q = input.value.trim().toLocaleLowerCase();
    chosen.replaceChildren(...shown(current).map((t) => el('span', { class: 'chip on', title: t }, tagText(t),
      el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${t}`, onclick: () => toggle(t) }, '×'))));
    sugBox.hidden = !sug.length;
    sugBox.replaceChildren(...(sug.length ? [el('span', { class: 'group-name' }, 'Suggested'), ...sug.map((t) => chip(t))] : []));
    const matches = store.tags.filter((t) => !hidden(t.tag) && !q || tagSearchText(t.tag).toLocaleLowerCase().includes(q));
    pool.replaceChildren(...tagGroups(matches).map((g) => el('div', { class: 'chip-group' },
      el('span', { class: 'group-name' }, g.name),
      ...[...g.tags].sort(g.key === 'decade' ? (a, b) => decadeRank(a.tag) - decadeRank(b.tag) : (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).map((t) => chip(t.tag, t.count)))));
    for (const fn of listeners) fn([...current]);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
  });
  input.addEventListener('input', render);
  if (year) {
    year.addEventListener('input', () => {
      current = withDecade(current, yearValue());
      sug = withDecade(sug, yearValue());
      render();
    });
  }
  render();

  return {
    node,
    getTags() { add(input.value); return [...current]; },
    peek() { return [...current]; },
    subscribe(fn) { listeners.push(fn); fn([...current]); },
    addTags(list) {
      for (const t of list) if (!isHiddenTag(t) && !has(t)) current.push(t);
      render();
    },
    removeTag(t) {
      current = current.filter((x) => !same(x, t));
      render();
    },
    setSuggested(list) {
      for (const t of shown(list)) if (!sug.some((x) => same(x, t))) sug.push(t);
      render();
    },
  };
}
