import { HIDE_CONTROLS_MS } from './viz-constants.js';

const SKIP_KEY_TARGETS = 'input, textarea, select, dialog, [contenteditable]';

export function isVizKey(e, { open, route }) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (String(e.key).toLowerCase() !== 'v') return false;
  if (e.target?.closest?.(SKIP_KEY_TARGETS)) return false;
  return open || route === 'playback';
}

export function isVizModeKey(e, { open, route, background }) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (String(e.key).toLowerCase() !== 'm') return false;
  if (e.target?.closest?.(SKIP_KEY_TARGETS)) return false;
  return open || (route === 'playback' && !!background);
}

export function isVizStyleKey(e, { open, route, background, mode }) {
  if (mode !== 'terrain') return false;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (String(e.key).toLowerCase() !== 't') return false;
  if (e.target?.closest?.(SKIP_KEY_TARGETS)) return false;
  return open || (route === 'playback' && !!background);
}

export function isNearBox(point, box, pad = 0) {
  if (!point || !box) return false;
  return point.x >= box.left - pad && point.x <= box.right + pad && point.y >= box.top - pad && point.y <= box.bottom + pad;
}

export function makeAutoHide({ delay = HIDE_CONTROLS_MS, setTimer = setTimeout, clearTimer = clearTimeout, onChange }) {
  let idle = false;
  let timer = null;
  const set = (v) => { if (idle !== v) { idle = v; onChange(v); } };
  const arm = () => {
    if (timer != null) clearTimer(timer);
    timer = setTimer(() => { timer = null; set(true); }, delay);
  };
  return {
    poke() { set(false); arm(); },
    stop() { if (timer != null) clearTimer(timer); timer = null; set(false); },
    get idle() { return idle; },
  };
}

export function createFullscreen({ root, opener, doc = document, onOpen, onClose, onIdle, setTimer, clearTimer, hideMs }) {
  let open = false;
  let native = false;
  const hider = makeAutoHide({
    delay: hideMs, setTimer, clearTimer, onChange: (idle) => { root.classList.toggle('idle', idle); if (idle) onIdle?.(); },
  });

  async function requestNative() {
    try {
      await root.requestFullscreen?.();
      native = doc.fullscreenElement === root;
    } catch { native = false; }
  }

  function openIt() {
    if (open) return;
    open = true;
    root.hidden = false;
    doc.body.classList.add('viz-full-open');
    opener.setAttribute('aria-pressed', 'true');
    opener.classList.add('on');
    hider.poke();
    root.focus?.();
    void requestNative();
    onOpen?.();
  }

  function closeIt() {
    if (!open) return;
    open = false;
    root.hidden = true;
    doc.body.classList.remove('viz-full-open');
    opener.setAttribute('aria-pressed', 'false');
    opener.classList.remove('on');
    hider.stop();
    if (native && doc.fullscreenElement === root) void doc.exitFullscreen?.();
    native = false;
    opener.focus?.();
    onClose?.();
  }

  doc.addEventListener('fullscreenchange', () => { if (open && native && doc.fullscreenElement !== root) closeIt(); });
  doc.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') { e.preventDefault?.(); closeIt(); }
  });
  return {
    open: openIt,
    close: closeIt,
    toggle() { if (open) closeIt(); else openIt(); },
    isOpen: () => open,
    poke: () => hider.poke(),
    get idle() { return hider.idle; },
  };
}
