export const playerInset = (stageBottom, miniTop, gap = 8) => {
  if (!Number.isFinite(stageBottom) || !Number.isFinite(miniTop)) return 0;
  return Math.max(0, Math.round(stageBottom - miniTop + gap));
};

export function watchPlayerInset(host, onChange, doc = document, win = window) {
  let last = -1;
  const mini = doc.getElementById('mini');
  const measure = () => {
    const shown = !!mini && !mini.hidden && mini.getClientRects().length > 0;
    const v = shown ? playerInset(host.getBoundingClientRect().bottom, mini.getBoundingClientRect().top) : 0;
    if (v !== last) { last = v; onChange(v); }
  };
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null;
  mo?.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  if (mini) mo?.observe(mini, { attributes: true, attributeFilter: ['hidden'] });
  const ro = typeof ResizeObserver === 'function' && mini ? new ResizeObserver(measure) : null;
  if (ro) ro.observe(mini);
  win.addEventListener('resize', measure);
  measure();
  return () => { mo?.disconnect(); ro?.disconnect(); win.removeEventListener('resize', measure); };
}
