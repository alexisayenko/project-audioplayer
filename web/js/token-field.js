import { el } from './dom.js';
import { icon } from './icons.js';
import { tokenize, isBlankToken, removeToken, replaceToken, appendToken, moveToken, moveTokenTo, stripEdges, commitTyped } from './tokens.js';

const KINDS = {
  title: { label: 'Title', move: 'Title', sep: ' - ' },
  artist: { label: 'Artist', move: 'Artist', sep: ', ' },
  remixer: { label: 'Remix & additional production', move: 'Remix', sep: ' ' },
};

const MIME = 'application/x-electrophone-token';
const END = Number.MAX_SAFE_INTEGER;
let drag = null;

function clearMarks() {
  for (const n of document.querySelectorAll('.drop-over, .drop-before')) n.classList.remove('drop-over', 'drop-before');
}

function locate(target) {
  const node = target && target.closest ? target.closest('.token-field') : null;
  if (!node || !node.acceptDrop) return null;
  const pill = target.closest('.token-pill');
  const own = pill && node.contains(pill);
  return { node, pill: own && !pill.classList.contains('dragging') ? pill : null, index: own ? Number(pill.dataset.i) : END };
}

function mark(hit) {
  clearMarks();
  if (!hit) return;
  if (hit.pill) hit.pill.classList.add('drop-before');
  else if (hit.index === END) hit.node.classList.add('drop-over');
}

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
  const cfg = KINDS[kind];
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

  function startTouchDrag(pill, i, e) {
    if (e.pointerType === 'mouse' || e.button > 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    let clone = null;
    let timer = setTimeout(() => {
      timer = null;
      active = true;
      drag = { kind, index: i };
      pill.classList.add('dragging');
      clone = pill.cloneNode(true);
      clone.classList.remove('dragging');
      clone.classList.add('token-drag-clone');
      clone.style.width = `${pill.offsetWidth}px`;
      document.body.append(clone);
      place(sx, sy);
      if (navigator.vibrate) navigator.vibrate(10);
    }, 250);
    const place = (x, y) => { clone.style.left = `${x - 20}px`; clone.style.top = `${y - 20}px`; };
    const hitAt = (x, y) => locate(document.elementFromPoint(x, y));
    const stopScroll = (ev) => { if (active && ev.cancelable) ev.preventDefault(); };
    const move = (ev) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cleanup();
        return;
      }
      place(ev.clientX, ev.clientY);
      mark(hitAt(ev.clientX, ev.clientY));
    };
    const noContext = (ev) => ev.preventDefault();
    function cleanup(drop, ev) {
      if (timer) clearTimeout(timer);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', stopScroll);
      pill.removeEventListener('contextmenu', noContext);
      const was = active;
      active = false;
      if (clone) clone.remove();
      clearMarks();
      pill.classList.remove('dragging');
      drag = null;
      if (was) {
        const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
        document.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallow, true), 400);
        const hit = drop && ev ? hitAt(ev.clientX, ev.clientY) : null;
        if (hit) hit.node.acceptDrop(kind, i, hit.index);
      }
    }
    const up = (ev) => cleanup(true, ev);
    const cancel = () => cleanup(false);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('touchmove', stopScroll, { passive: false });
    pill.addEventListener('contextmenu', noContext);
  }

  function openMenu(btn, pill, i, label) {
    const again = menu && menu.btn === btn;
    closeMenu();
    if (again) return;
    const items = [{ label: 'Edit text', run: () => editPill(pill, i, label) }];
    for (const k of Object.keys(KINDS)) {
      if (k !== kind && fields[k]) items.push({ label: `Move to ${KINDS[k].move}`, run: () => moveTo(i, k) });
    }
    items.push({ label: 'Remove', danger: true, run: () => removeAt(i) });
    const m = el('div', { class: 'menu token-menu', role: 'menu' }, items.map((it) => el('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`, type: 'button', role: 'menuitem',
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
    for (const p of [...node.querySelectorAll('.token-pill')]) p.remove();
    tokenize(text).forEach((t, i) => {
      if (isBlankToken(t)) return;
      const label = t.text.trim();
      const pencil = el('button', { type: 'button', class: 'token-btn', 'aria-label': `Edit ${label}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('pencil', 14));
      const x = el('button', { type: 'button', class: 'token-btn', 'aria-label': `Remove ${label}` }, icon('clear', 14));
      const pill = el('span', { class: 'token-pill', draggable: 'true', 'data-i': String(i) }, pencil, el('span', { class: 'token-text' }, label), x);
      pill.addEventListener('dragstart', (e) => {
        if (pill.classList.contains('editing')) { e.preventDefault(); return; }
        drag = { kind, index: i };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(MIME, JSON.stringify(drag));
        e.dataTransfer.setData('text/plain', label);
        setTimeout(() => pill.classList.add('dragging'), 0);
      });
      pill.addEventListener('dragend', () => { pill.classList.remove('dragging'); clearMarks(); drag = null; });
      pill.addEventListener('pointerdown', (e) => { if (!pill.classList.contains('editing')) startTouchDrag(pill, i, e); });
      pencil.addEventListener('click', () => openMenu(pencil, pill, i, label));
      x.addEventListener('click', () => removeAt(i));
      node.insertBefore(pill, entry);
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
    if (!e.dataTransfer || !e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    mark(locate(e.target));
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) { node.classList.remove('drop-over'); for (const p of node.querySelectorAll('.drop-before')) p.classList.remove('drop-before'); }
  });
  node.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    let src = null;
    try { src = JSON.parse(e.dataTransfer.getData(MIME)); } catch { src = drag; }
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
