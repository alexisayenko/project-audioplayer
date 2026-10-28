import { el } from './dom.js';
import { icon } from './icons.js';
import { cleanLabels, LABEL_LENGTH, LABEL_LIMIT } from './label-names.js';
import { libraryLabels } from './label-suggest.js';

let seq = 0;

const PLACEHOLDER = 'Add a label, such as Parvati Records';

export function labelField({ initial = [], suggestions = libraryLabels, label = 'Labels' } = {}) {
  let names = cleanLabels(initial);
  const subs = new Set();
  const listId = `label-names-${++seq}`;
  const input = el('input', { type: 'text', placeholder: PLACEHOLDER, 'aria-label': label, enterKeyHint: 'done', autocomplete: 'off', list: listId, maxLength: LABEL_LENGTH });
  const options = el('datalist', { id: listId });
  const chips = el('div', { class: 'chips' });
  const hint = el('p', { class: 't-caption muted', role: 'status', hidden: true });
  const node = el('div', { class: 'field label-field' }, el('label', {}, label), el('div', { class: 'chip-field' }, chips, input), options, hint);

  const notify = () => { for (const f of subs) f(); };

  function paintOptions() {
    const taken = new Set(names.map((n) => n.toLowerCase()));
    options.replaceChildren(...suggestions().filter((n) => !taken.has(n.toLowerCase())).slice(0, 50).map((n) => el('option', { value: n })));
  }

  function paint() {
    chips.replaceChildren(...names.map((n) => el('span', { class: 'chip tint', title: n },
      n,
      el('button', { type: 'button', class: 'x', 'aria-label': `Remove ${n}`, onclick: () => { names = names.filter((x) => x !== n); paint(); notify(); input.focus(); } }, icon('clear', 'inline')))));
    chips.hidden = !names.length;
    paintOptions();
  }

  function add(list) {
    const wanted = cleanLabels(list);
    const next = cleanLabels([...names, ...wanted]);
    const lost = wanted.some((n) => !next.some((x) => x.toLowerCase() === n.toLowerCase()));
    hint.textContent = lost ? `A release can have up to ${LABEL_LIMIT} labels.` : '';
    hint.hidden = !lost;
    if (next.length === names.length) return;
    names = next;
    paint();
    notify();
  }

  function commit() {
    const parts = input.value.split(',').map((p) => p.trim()).filter(Boolean);
    input.value = '';
    if (parts.length) add(parts);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && names.length) {
      names = names.slice(0, -1);
      paint();
      notify();
    }
  });
  input.addEventListener('input', (e) => {
    hint.hidden = true;
    const value = input.value;
    if (value.includes(',')) {
      const at = value.lastIndexOf(',');
      const done = value.slice(0, at).split(',').map((p) => p.trim()).filter(Boolean);
      input.value = value.slice(at + 1).trimStart();
      if (done.length) add(done);
      return;
    }
    const picked = !e.inputType || e.inputType === 'insertReplacementText';
    if (picked && suggestions().some((n) => n.toLowerCase() === value.trim().toLowerCase())) commit();
  });
  input.addEventListener('focus', paintOptions);
  input.addEventListener('blur', commit);
  paint();

  return {
    node,
    input,
    get: () => [...names],
    set(list) {
      names = cleanLabels(list);
      paint();
      notify();
    },
    add: (list) => add(cleanLabels(list)),
    commit,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
