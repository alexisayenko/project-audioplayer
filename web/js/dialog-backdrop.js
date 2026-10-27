function insideBox(dlg, e) {
  const r = dlg.getBoundingClientRect?.();
  if (!r || !r.width || !r.height || e.clientX === undefined) return false;
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

export function backdropClose(dlg, { dirty = () => false, close = () => dlg.close() } = {}) {
  let down = null;
  const onBackdrop = (e) => e.target === dlg && !insideBox(dlg, e);
  dlg.onmousedown = (e) => { down = onBackdrop(e); };
  dlg.onclick = (e) => {
    const started = down === null || down;
    down = null;
    if (started && onBackdrop(e) && !dirty()) close();
  };
}
