// Minimal zero-dependency DOM shim for smoke tests. Not a spec-complete DOM.
const REFLECT = ['id', 'type', 'href', 'src', 'placeholder', 'title', 'name', 'htmlFor', 'autocomplete', 'role', 'download', 'min', 'max', 'step', 'rel', 'target', 'alt', 'lang', 'inputMode'];

function* ancestry(n) {
  for (let c = n; c; c = c.parentNode) yield c;
}

const dataAttr = (k) => `data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;

export class DomNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get nodeType() { return this._type; }
  get parentElement() { return this.parentNode?._type === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes.at(-1) || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  remove() {
    if (this.parentNode) {
      this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
      this.parentNode = null;
    }
  }
  contains(n) {
    for (const c of ancestry(n)) {
      if (c === this) return true;
    }
    return false;
  }
}

export class Text extends DomNode {
  constructor(t) { super(); this._type = 3; this.data = String(t); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  cloneNode() { return new Text(this.data); }
}

class ClassList {
  constructor(e) { this.e = e; }
  _a() { return this.e.className.split(/\s+/).filter(Boolean); }
  _s(a) { this.e.className = a.join(' '); }
  add(...c) { const a = this._a(); c.forEach((x) => { if (!a.includes(x)) a.push(x); }); this._s(a); }
  remove(...c) { this._s(this._a().filter((x) => !c.includes(x))); }
  contains(c) { return this._a().includes(c); }
  toggle(c, force) {
    const has = this.contains(c);
    const on = force === undefined ? !has : !!force;
    if (on && !has) this.add(c); else if (!on && has) this.remove(c);
    return on;
  }
}

const SIMPLE_TOKEN = new RegExp(`^(?:${[
  String.raw`([a-zA-Z][\w-]*|\*)`,
  String.raw`#([\w-]+)`,
  String.raw`\.([\w-]+)`,
  String.raw`\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]`,
  String.raw`:not\((.*?)\)`,
  ":(disabled|enabled|checked)",
].join('|')})`);

function parseSimple(s) {
  const out = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let rest = s;
  while (rest) {
    const m = SIMPLE_TOKEN.exec(rest);
    if (!m) throw new Error(`test-dom: unsupported selector ${s}`);
    if (m[1] && m[1] !== '*') out.tag = m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push([m[4], m[5] ?? m[6] ?? m[7] ?? null]);
    else if (m[8]) out.nots.push(parseSimple(m[8]));
    else if (m[9]) out.attrs.push([`:${m[9]}`, null]);
    rest = rest.slice(m[0].length);
  }
  return out;
}

function pseudoFails(e, k) {
  if (k === ':disabled') return !e.disabled;
  if (k === ':enabled') return !!e.disabled;
  return !e.checked;
}

function matchSimple(e, p) {
  if (p.tag && e.localName !== p.tag) return false;
  if (p.id && e.getAttribute('id') !== p.id) return false;
  if (!p.classes.every((c) => e.classList.contains(c))) return false;
  for (const [k, v] of p.attrs) {
    if (k === ':disabled' || k === ':enabled' || k === ':checked') {
      if (pseudoFails(e, k)) return false;
      continue;
    }
    const a = e.getAttribute(k);
    if (a === null || (v !== null && a !== v)) return false;
  }
  return !p.nots.some((n) => matchSimple(e, n));
}

function parseSelector(sel) {
  return sel.split(',').map((part) => part.replaceAll('>', ' > ').split(/\s+/).filter(Boolean));
}

function matches(e, chain, root) {
  const tokens = chain.slice();
  const last = tokens.pop();
  if (!matchSimple(e, parseSimple(last))) return false;
  let cur = e;
  while (tokens.length) {
    let t = tokens.pop();
    let direct = false;
    if (t === '>') { direct = true; t = tokens.pop(); }
    const p = parseSimple(t);
    cur = cur.parentElement;
    if (direct) {
      if (!cur || cur === root || !matchSimple(cur, p)) return false;
      continue;
    }
    while (cur && cur !== root && !matchSimple(cur, p)) cur = cur.parentElement;
    if (!cur || cur === root) return false;
  }
  return true;
}

export class DomElement extends DomNode {
  constructor(tag, ns) {
    super();
    this._type = 1;
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    this.namespaceURI = ns || null;
    this._attrs = new Map();
    this._ls = new Map();
    this.className = '';
    this.classList = new ClassList(this);
    this.dataset = new Proxy({}, {
      set: (t, k, v) => { t[k] = String(v); this._attrs.set(dataAttr(k), String(v)); return true; },
      deleteProperty: (t, k) => { delete t[k]; this._attrs.delete(dataAttr(k)); return true; },
    });
    this.style = { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; }, getPropertyValue(k) { return this._p[k] ?? ''; } };
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.scrollTop = 0;
    this.focused = 0;
    this.innerHTML = '';
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    const cls = this.getAttribute?.('class');
    const id = this.getAttribute?.('id');
    const idAttr = id ? ` id=${id}` : '';
    const classAttr = cls ? ` class="${cls}"` : '';
    return `<${this.localName}${idAttr}${classAttr}>`;
  }

  get children() { return this.childNodes.filter((n) => n._type === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get nextElementSibling() {
    const sibs = this.parentNode ? this.parentNode.children : [];
    return sibs[sibs.indexOf(this) + 1] || null;
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; if (v !== '' && v != null) this.append(new Text(v)); }
  get offsetHeight() { return 40; }
  get offsetWidth() { return 120; }
  get isConnected() {
    for (const c of ancestry(this)) {
      if (c === globalThis.document) return true;
    }
    return false;
  }

  _adopt(n) {
    if (typeof n === 'string') n = new Text(n);
    if (n.parentNode) n.remove();
    n.parentNode = this;
    return n;
  }
  append(...ns) { for (const n of ns) this.childNodes.push(this._adopt(n)); }
  appendChild(n) { this.append(n); return n; }
  prepend(...ns) { this.childNodes.unshift(...ns.map((n) => this._adopt(n))); }
  replaceChildren(...ns) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; this.append(...ns); }
  insertBefore(n, ref) {
    n = this._adopt(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    return n;
  }
  before(...ns) {
    const p = this.parentNode;
    if (p) {
      ns.forEach((n) => p.insertBefore(n, this));
    }
  }
  replaceWith(n) {
    const p = this.parentNode;
    if (!p) return;
    p.insertBefore(n, this);
    this.remove();
  }
  cloneNode(deep) {
    const c = new DomElement(this.localName, this.namespaceURI);
    for (const [k, v] of this._attrs) c.setAttribute(k, v);
    c.className = this.className; c.value = this.value; c.checked = this.checked; c.disabled = this.disabled; c.hidden = this.hidden;
    if (deep) this.childNodes.forEach((n) => c.append(n.cloneNode(true)));
    return c;
  }

  setAttribute(k, v) {
    v = String(v);
    this._attrs.set(k, v);
    if (k === 'class') this.className = v;
    if (k === 'value') this.value = v;
    if (k === 'disabled') this.disabled = true;
    if (k === 'hidden') this.hidden = true;
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  getAttribute(k) {
    if (k === 'class') return this.className || (this._attrs.has('class') ? this._attrs.get('class') : null);
    if (k === 'disabled') return this.disabled ? '' : null;
    if (k === 'hidden') return this.hidden ? '' : null;
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) {
    this._attrs.delete(k);
    if (k === 'disabled') this.disabled = false;
    if (k === 'hidden') this.hidden = false;
    if (k === 'class') this.className = '';
  }
  toggleAttribute(k, force) {
    const on = force === undefined ? !this.hasAttribute(k) : force;
    if (on) {
      this.setAttribute(k, '');
    } else {
      this.removeAttribute(k);
    }
    return on;
  }

  addEventListener(t, fn) {
    if (!this._ls.has(t)) this._ls.set(t, []);
    this._ls.get(t).push(fn);
  }
  removeEventListener(t, fn) {
    const a = this._ls.get(t) ?? [];
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    for (const n of ancestry(this)) {
      if (ev._stop) break;
      ev.currentTarget = n;
      const prop = n['on' + ev.type];
      if (typeof prop === 'function') prop.call(n, ev);
      for (const fn of (n._ls?.get(ev.type) || []).slice()) fn.call(n, ev);
      if (!ev.bubbles) break;
    }
    return !ev.defaultPrevented;
  }
  click() { if (!this.disabled) this.dispatchEvent(makeEvent('click', { bubbles: true })); }
  focus() { this.focused += 1; if (globalThis.document) globalThis.document.activeElement = this; }
  blur() { return undefined; }
  select() { return undefined; }
  setSelectionRange() { return undefined; }
  scrollIntoView() { return undefined; }
  setPointerCapture() { return undefined; }
  releasePointerCapture() { return undefined; }
  showModal() { this.open = true; }
  show() { this.open = true; }
  close() { if (this.open) { this.open = false; this.dispatchEvent(makeEvent('close')); } }
  getBoundingClientRect() { return { top: 0, left: 0, right: 120, bottom: 40, width: 120, height: 40, x: 0, y: 0 }; }

  closest(sel) {
    const chains = parseSelector(sel);
    for (const n of ancestry(this)) {
      if (n._type !== 1) break;
      if (chains.some((c) => matches(n, c, null))) return n;
    }
    return null;
  }
  querySelectorAll(sel) {
    const chains = parseSelector(sel);
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (chains.some((ch) => matches(c, ch, this))) {
          out.push(c);
        }
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getElementById(id) { return this.querySelectorAll(`#${id}`)[0] || null; }
}

for (const k of REFLECT) {
  Object.defineProperty(DomElement.prototype, k, {
    get() { return this.getAttribute(k === 'htmlFor' ? 'for' : k) ?? ''; },
    set(v) { this.setAttribute(k === 'htmlFor' ? 'for' : k, v); },
    configurable: true,
  });
}

export function makeEvent(type, init = {}) {
  return { type, bubbles: false, defaultPrevented: false, _stop: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, stopImmediatePropagation() { this._stop = true; }, ...init };
}

// A failing test skips its cleanup and leaves poll timers behind; unref'd long timers and intervals keep node from hanging after the run.
const LONG_TIMER_MS = 1000;

function unrefLongTimers() {
  if (globalThis.setTimeout.__unrefLong) return;
  const nativeTimeout = globalThis.setTimeout;
  const nativeInterval = globalThis.setInterval;
  const timeout = (fn, ms, ...args) => {
    const t = nativeTimeout(fn, ms, ...args);
    if (ms >= LONG_TIMER_MS) t?.unref?.();
    return t;
  };
  timeout.__unrefLong = true;
  const interval = (fn, ms, ...args) => {
    const t = nativeInterval(fn, ms, ...args);
    t?.unref?.();
    return t;
  };
  globalThis.setTimeout = timeout;
  globalThis.setInterval = interval;
}

export function installDom({ ids = [] } = {}) {
  unrefLongTimers();
  const listeners = new Map();
  const doc = new DomElement('#document');
  doc.activeElement = null;
  doc.hidden = false;
  doc.title = '';
  doc.createElement = (t) => new DomElement(t);
  doc.createElementNS = (ns, t) => new DomElement(t, ns);
  doc.createTextNode = (t) => new Text(t);
  doc.documentElement = new DomElement('html');
  doc.documentElement.scrollHeight = 2000;
  doc.body = new DomElement('body');
  doc.head = new DomElement('head');
  doc.head.append = (n) => { DomElement.prototype.append.call(doc.head, n); if (n.localName === 'script') setTimeout(() => (globalThis.__scriptFail ? n.onerror?.() : n.onload?.()), 0); };
  doc.append(doc.documentElement);
  doc.documentElement.append(doc.head, doc.body);
  for (const id of ids) { const e = new DomElement(id === 'audio' ? 'audio' : 'div'); e.setAttribute('id', id); doc.body.append(e); }
  const store = new Map();
  const win = {
    innerHeight: 800, innerWidth: 400, scrollY: 0,
    addEventListener(t, fn) {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    removeEventListener() {},
    dispatchEvent(ev) { this.dispatch(ev.type, ev); return true; },
    dispatch(t, ev = {}) { (listeners.get(t) || []).forEach((fn) => fn({ type: t, ...ev })); },
    scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    _map: store,
  };
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('document', doc); set('window', win); set('localStorage', storage); set('matchMedia', win.matchMedia);
  set('CSS', { escape: (s) => String(s).replace(/["\\]/g, String.raw`\$&`) });
  set('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  set('Event', function MockEvent(type, init = {}) { Object.assign(this, makeEvent(type, init)); });
  set('CustomEvent', globalThis.Event);
  doc.addEventListener = DomElement.prototype.addEventListener.bind(doc);
  return { document: doc, window: win, storage };
}

export const byId = (id) => document.getElementById(id);
export function text(node) { return node.textContent; }
export function fire(node, type, init = {}) { return node.dispatchEvent(makeEvent(type, { bubbles: true, ...init })); }
export const flush = () => new Promise((r) => setTimeout(r, 0));
export function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = url instanceof URL ? url.href : url;
    calls.push({ url: u, opts });
    const r = await handler(u, opts);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status, headers: { get: (k) => r.headers?.[k.toLowerCase()] ?? null },
      json: async () => r.body, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return calls;
}

export function makeAudio(e) {
  e.paused = true;
  e.currentTime = 0;
  e.duration = Number.NaN;
  e.volume = 1;
  e.playbackRate = 1;
  e.plays = 0;
  e.play = () => { e.paused = false; e.plays += 1; e.dispatchEvent(makeEvent('play')); return Promise.resolve(); };
  e.pause = () => { if (!e.paused) { e.paused = true; e.dispatchEvent(makeEvent('pause')); } };
  e.load = () => {};
  return e;
}

// Builds every element of web/index.html that has an id (flat under <body>), enough for modules that look elements up by id.
export async function installPage() {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = installDom();
  const re = /<([a-z0-9]+)\b([^>]*?)\bid="([a-z0-9-]+)"([^>]*)>/gi;
  for (const m of html.matchAll(re)) {
    const [, tag, pre, id, post] = m;
    const e = new DomElement(tag);
    e.setAttribute('id', id);
    const cls = /class="([^"]*)"/.exec(pre + post);
    if (cls) e.setAttribute('class', cls[1]);
    if (/\bhidden\b/.test(pre + post)) e.hidden = true;
    if (id === 'audio') makeAudio(e);
    document.body.append(e);
  }
  return dom;
}
