import { el } from './dom.js';
import { icon } from './icons.js';
import { MIME, dragState, clearMarks, locate, mark, startTouchDrag } from './token-drag.js';
import { tokenize, isBlankToken, removeToken, replaceToken, appendToken, moveToken, moveTokenTo, stripEdges, commitTyped, SEPARATOR } from './tokens.js';

const KINDS = {
  title: { label: 'Title', move: 'Title', sep: SEPARATOR },
  artists: { label: 'Artists', move: 'Artists', sep: SEPARATOR },
  featured: { label: 'Featuring', move: 'Featuring', sep: SEPARATOR },
  by: { label: 'Remixed / mixed by', move: 'Remixed / mixed by', sep: SEPARATOR },
  of: { label: 'Cover of', move: 'Cover / mashup sources', sep: SEPARATOR },
};

export function tokenGroup() {
  const fields = {};
  return {
    field(kind, value = '') {
      const node = tokenField(kind, fields);
      fields[kind] = node;
      node.value = value;
      return node;
    },
  };
}

function tokenField(kind, fields) {
  const cfg = { ...KINDS[kind] };
  let text = '';
  let tail = false;
  let menu = null;
  const entry = el('input', { type: 'text', class: 'token-entry', 'aria-label': cfg.label, autocomplete: 'off' });
  const node = el('div', { class: 'token-field', role: 'group', 'aria-label': cfg.label }, entry);

  const pending = () => entry.value;
  const read = () => {
    const p = pending();
    const t = p.trim() ? appendToken(text, p, cfg.sep) : text;
    return tail && !p.trim() ? stripEdges(t) : t;
  };
  const count = () => tokenize(text).filter((t) => !isBlankToken(t)).length;
  const fire = () => node.dispatchEvent(new Event('input', { bubbles: true }));
  const set = (v) => { text = v; tail = false; render(); };

  const closeMenu = () => {
    if (!menu) return;
    menu.node.remove();
    menu.btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', menu.outside, true);
    menu = null;
  };

  const commitPending = () => {
    if (!pending().trim()) return;
    text = appendToken(text, pending(), cfg.sep);
    entry.value = '';
    tail = false;
    render();
  };

  function editPill(pill, i, current) {
    closeMenu();
    const input = el('input', { type: 'text', class: 'token-edit', 'aria-label': `Edit ${current}`, value: current, autocomplete: 'off' });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value;
      if (save && v.trim() !== current) {
        text = replaceToken(text, i, v);
        tail = false;
        render();
        fire();
      } else {
        render();
      }
    };
    input.addEventListener('input', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); entry.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); entry.focus(); }
    });
    input.addEventListener('blur', () => finish(true));
    pill.replaceChildren(input);
    pill.classList.add('editing');
    input.focus();
    input.select();
  }

  function moveTo(i, target) {
    const dst = fields[target];
    if (!dst) return;
    const r = moveToken(text, i, dst.value, KINDS[target].sep);
    set(r.src);
    fire();
    dst.value = r.dst;
    dst.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function acceptDrop(fromKind, i, dstIndex) {
    const srcF = fields[fromKind];
    if (!srcF) return;
    const from = srcF.value;
    if (fromKind === kind) {
      const r = moveTokenTo(from, i, from, dstIndex, cfg.sep, true);
      if (r.dst === from) return;
      node.value = r.dst;
      fire();
      return;
    }
    const to = node.value;
    const r = moveTokenTo(from, i, to, dstIndex, cfg.sep, false);
    if (r.src === from && r.dst === to) return;
    srcF.value = r.src;
    srcF.dispatchEvent(new Event('input', { bubbles: true }));
    node.value = r.dst;
    fire();
  }
  node.acceptDrop = acceptDrop;
  node.setLabel = (label) => {
    cfg.label = label;
    entry.setAttribute('aria-label', label);
    node.setAttribute('aria-label', label);
  };
  node.moveTo = (i, target) => { if (kind !== 'title' || count() > 1) moveTo(i, target); };

  function openMenu(btn, pill, i, label) {
    const again = menu && menu.btn === btn;
    closeMenu();
    if (again) return;
    const items = [{ label: 'Edit text', run: () => editPill(pill, i, label) }];
    for (const k of Object.keys(KINDS)) {
      if (k !== kind && fields[k]) items.push({ label: `Move to ${KINDS[k].move}`, disabled: kind === 'title' && count() < 2, run: () => moveTo(i, k) });
    }
    items.push({ label: 'Remove', danger: true, run: () => removeAt(i) });
    const m = el('div', { class: 'menu token-menu', role: 'menu' }, items.map((it) => el('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`, type: 'button', role: 'menuitem', disabled: !!it.disabled,
      onclick: () => { closeMenu(); it.run(); },
    }, it.label)));
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); btn.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const bs = [...m.querySelectorAll('button')];
        const at = bs.indexOf(document.activeElement);
        bs[(at + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
      }
    });
    pill.append(m);
    btn.setAttribute('aria-expanded', 'true');
    const outside = (e) => { if (!m.contains(e.target) && !btn.contains(e.target)) closeMenu(); };
    document.addEventListener('click', outside, true);
    menu = { node: m, btn, outside };
    m.querySelector('button').focus();
  }

  function removeAt(i) {
    closeMenu();
    text = removeToken(text, i);
    tail = false;
    render();
    fire();
    entry.focus();
  }

  function render() {
    closeMenu();
    for (const p of node.querySelectorAll('.token-pill')) p.remove();
    tokenize(text).forEach((t, i) => {
      if (isBlankToken(t)) return;
      const label = t.text.trim();
      const pencil = el('button', { type: 'button', class: 'token-btn', 'aria-label': `Edit ${label}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('pencil', 'inline'));
      const x = el('button', { type: 'button', class: 'token-btn', 'aria-label': `Remove ${label}` }, icon('clear', 'inline'));
      const pill = el('span', { class: 'token-pill', draggable: 'true', 'data-i': String(i) }, pencil, el('span', { class: 'token-text' }, label), x);
      pill.addEventListener('dragstart', (e) => {
        if (pill.classList.contains('editing')) { e.preventDefault(); return; }
        dragState.current = { kind, index: i };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(MIME, JSON.stringify(dragState.current));
        e.dataTransfer.setData('text/plain', label);
        setTimeout(() => pill.classList.add('dragging'), 0);
      });
      pill.addEventListener('dragend', () => { pill.classList.remove('dragging'); clearMarks(); dragState.current = null; });
      pill.addEventListener('pointerdown', (e) => { if (!pill.classList.contains('editing')) startTouchDrag(kind, pill, i, e); });
      pencil.addEventListener('click', () => openMenu(pencil, pill, i, label));
      x.addEventListener('click', () => removeAt(i));
      entry.before(pill);
    });
  }

  entry.addEventListener('input', () => {
    const r = commitTyped(text, pending(), cfg.sep);
    if (r.rest === pending()) return;
    text = r.value;
    tail = true;
    entry.value = r.rest;
    render();
  });
  entry.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && pending().trim()) { e.preventDefault(); commitPending(); fire(); }
  });
  entry.addEventListener('blur', () => {
    if (menu) return;
    if (pending().trim()) { commitPending(); fire(); }
    if (tail) { text = stripEdges(text); tail = false; render(); fire(); }
  });
  node.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    mark(locate(e.target));
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) { node.classList.remove('drop-over'); for (const p of node.querySelectorAll('.drop-before')) p.classList.remove('drop-before'); }
  });
  node.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes(MIME)) return;
    e.preventDefault();
    let src = null;
    try { src = JSON.parse(e.dataTransfer.getData(MIME)); } catch { src = dragState.current; }
    const hit = locate(e.target);
    clearMarks();
    if (src && hit) hit.node.acceptDrop(src.kind, src.index, hit.index);
  });
  node.addEventListener('click', (e) => { if (e.target === node) entry.focus(); });

  Object.defineProperty(node, 'value', {
    configurable: true,
    get: read,
    set(v) { entry.value = ''; set(String(v ?? '')); },
  });
  node.focus = () => entry.focus();
  return node;
}
