import { el } from './dom.js';

export function originalGenres(resp, have = []) {
  const list = Array.isArray(resp?.original_genres) ? resp.original_genres : [];
  const taken = new Set(have.map((t) => String(t).toLowerCase()));
  return [...new Set(list.filter((t) => typeof t === 'string' && /^genre:\S/i.test(t) && !taken.has(t.toLowerCase())))];
}

export function originalBox(onPick) {
  const list = el('span', {});
  const node = el('p', { class: 't-caption muted original-genres', hidden: true }, 'From the original (not applied): ', list);
  const set = (tags) => {
    list.replaceChildren();
    tags.forEach((tag, i) => {
      const b = el('button', { class: 'link-btn t-caption', type: 'button', title: 'Add this genre' }, tag.slice(tag.indexOf(':') + 1));
      b.addEventListener('click', () => {
        onPick(tag);
        b.remove();
        node.hidden = !list.childElementCount;
      });
      if (i) list.append(', ');
      list.append(b);
    });
    node.hidden = !tags.length;
  };
  return { node, set, clear: () => set([]) };
}
