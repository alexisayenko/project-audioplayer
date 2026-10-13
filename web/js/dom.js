const TAG_STYLE = { label: 't-caption', small: 't-caption', h2: 't-title' };

function setProp(node, k, v) {
  if (k === 'class') node.className = v;
  else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
  else if (k in node && k !== 'list') node[k] = v;
  else node.setAttribute(k, v === true ? '' : v);
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v != null && v !== false) setProp(node, k, v);
  }
  if (TAG_STYLE[tag] && !/\bt-/.test(node.className)) node.classList.add(TAG_STYLE[tag]);
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export const plural = (n, one, other) => (n === 1 ? one : other);

let toastTimer;
export function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

export function pageHead(title, sub) {
  return el('header', { class: 'page-head' },
    el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
    el('h1', { class: 't-display' }, title),
    sub ? el('p', { class: 'muted t-subhead' }, sub) : null);
}
