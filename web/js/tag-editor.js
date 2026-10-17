import { el } from './dom.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { splitInput } from './tag-input.js';
import { canonicalCountry, filterCountries } from './countries.js';
import { resolveGenre, cachedIndex } from './genre-vocab.js';
import { isHiddenTag, tagGroups, tagLabel, tagText, tagSearchText } from './tagname.js';

const same = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

export function tagEditor({ tags = [], suggested = [], onChange = null, hideNs = false } = {}) {
  const listeners = onChange ? [onChange] : [];
  const hidden = (t) => isHiddenTag(t) || (hideNs && /^(genre|country):/i.test(t));
  const shown = (list) => list.filter((t) => !hidden(t));
  let current = [...tags];
  let sug = shown(suggested);
  const input = el('input', { type: 'text', placeholder: 'Type a tag (plain or key:value), Enter or comma to add', enterKeyHint: 'done', autocomplete: 'off' });
  const chosen = el('div', { class: 'chips' });
  const sugBox = el('div', { class: 'chip-group' });
  const pool = el('div', { class: 'chip-groups tag-pool' });
  const picker = el('div', { class: 'chip-group country-picker', hidden: true });
  const note = el('small', { class: 'country-note', role: 'status', hidden: true }, 'Pick a country from the list');
  const node = el('div', { class: 'tag-editor' }, input, note, picker, chosen, sugBox, pool);
  const COUNTRY = /^\s*country\s*:/i;
  const isCountry = (t) => /^country:/i.test(t);
  const isGenre = (t) => /^genre:/i.test(t);
  const badCountry = (t) => isCountry(t) && !canonicalCountry(t.slice(8));

  const has = (t) => current.some((x) => same(x, t));
  const toggle = (t) => {
    current = has(t) ? current.filter((x) => !same(x, t)) : [...current.filter((x) => !(isCountry(t) && isCountry(x))), t];
    render();
  };
  function add(raw) {
    const { tags: added, rest } = splitInput(raw);
    const refused = [];
    for (let t of added) {
      if (isCountry(t)) {
        const code = canonicalCountry(t.slice(t.indexOf(':') + 1));
        if (!code) { refused.push(t); continue; }
        t = `country:${code}`;
      } else if (isGenre(t)) {
        const hit = resolveGenre(t.slice(t.indexOf(':') + 1), cachedIndex());
        if (!hit) { refused.push(t); continue; }
        t = `genre:${hit.name}`;
      }
      if (!isHiddenTag(t) && !has(t)) current.push(t);
    }
    input.value = [rest, ...refused].filter(Boolean).join(', ');
    note.hidden = !refused.length;
    note.textContent = refused.some(isGenre) ? 'Pick a genre from the Genres list' : 'Pick a country from the list';
    render();
  }

  function chip(t, count) {
    return el('button', { type: 'button', class: `chip${has(t) ? ' on' : ''}`, title: t, 'aria-pressed': String(has(t)), onclick: () => toggle(t) },
      tagLabel(t), count != null ? el('small', {}, count) : null);
  }

  function render() {
    const q = input.value.trim().toLocaleLowerCase();
    const cq = COUNTRY.test(input.value) ? input.value.replace(COUNTRY, '') : null;
    picker.hidden = cq === null;
    picker.replaceChildren(...(cq === null ? [] : filterCountries(cq, 8).map(({ code, name }) => el('button', {
      type: 'button', class: 'chip', title: `country:${code}`,
      onclick: () => { current = has(`country:${code}`) ? current : [...current, `country:${code}`]; input.value = ''; note.hidden = true; render(); },
    }, name, el('small', {}, code.toUpperCase())))));
    chosen.replaceChildren(...shown(current).map((t) => el('span', { class: 'chip on', style: badCountry(t) ? 'border:1px dashed currentColor' : null, title: badCountry(t) ? `${t}: not a known country, remove it or pick one from the list` : t }, badCountry(t) ? [icon('warning', 'inline'), tagText(t)] : tagText(t),
      el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${t}`, onclick: () => toggle(t) }, icon('clear', 'inline')))));
    sugBox.hidden = !sug.length;
    sugBox.replaceChildren(...(sug.length ? [el('span', { class: 'group-name' }, 'Suggested'), ...sug.map((t) => chip(t))] : []));
    const matches = store.tags.filter((t) => !hidden(t.tag) && (!q || tagSearchText(t.tag).toLocaleLowerCase().includes(q)));
    pool.replaceChildren(...tagGroups(matches).map((g) => el('div', { class: 'chip-group' },
      el('span', { class: 'group-name' }, g.name),
      ...[...g.tags].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).map((t) => chip(t.tag, t.count)))));
    for (const fn of listeners) fn([...current]);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
  });
  input.addEventListener('input', render);
  render();

  return {
    node,
    getTags({ commit = true } = {}) {
      if (commit) add(input.value);
      return [...current];
    },
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
    setSuggested(list, { all = false } = {}) {
      for (const t of all ? list.filter((x) => !isHiddenTag(x)) : shown(list)) if (!sug.some((x) => same(x, t))) sug.push(t);
      render();
    },
  };
}
