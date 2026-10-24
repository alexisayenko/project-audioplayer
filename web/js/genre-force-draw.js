const TAU = 2 * Math.PI;

export const DISCOGS_RING = { lw: 1.2, dash: 3, gap: 2.5, pad: 2.5 };
export const GROUP_RING = { lw: 1.5, dash: 4, gap: 3, pad: 4 };

export function strokeRing(ctx, n, extra, w, color, k) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = w / k;
  ctx.beginPath(); ctx.arc(n.x, n.y, n.r + extra / k, 0, TAU); ctx.stroke();
}

export function dashedRing(ctx, colors, n, r, a, k, { lw, dash, gap, pad }) {
  ctx.globalAlpha = a;
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = lw / k;
  ctx.setLineDash([dash / k, gap / k]);
  ctx.beginPath(); ctx.arc(n.x, n.y, r + pad / k, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
}

export function drawBadge(ctx, colors, n, r, a, k) {
  ctx.globalAlpha = Math.max(a, 0.6);
  const br = 5.5 / k;
  const off = (r + 4 / k) * 0.72;
  const bx = n.x + off;
  const by = n.y - off;
  ctx.fillStyle = colors.warn;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
  ctx.strokeStyle = colors.halo;
  ctx.lineWidth = 1.5 / k;
  ctx.stroke();
  ctx.fillStyle = colors.halo;
  ctx.font = `bold ${8 / k}px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', bx, by + 0.5 / k);
}

export function drawMark(ctx, colors, n, r, a, k, state) {
  ctx.globalAlpha = Math.max(a, 0.7);
  const br = 5 / k;
  const off = (r + 3 / k) * 0.72;
  const bx = n.x + off;
  const by = n.y + off;
  ctx.fillStyle = colors.ink;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
  ctx.strokeStyle = colors.halo;
  ctx.lineWidth = 1.5 / k;
  ctx.stroke();
  ctx.strokeStyle = colors.halo;
  ctx.lineWidth = 1.4 / k;
  const d = 2.4 / k;
  ctx.beginPath();
  ctx.moveTo(bx - d, by); ctx.lineTo(bx + d, by);
  if (state === 'closed') { ctx.moveTo(bx, by - d); ctx.lineTo(bx, by + d); }
  ctx.stroke();
}

export function paintFlash(ctx, colors, n, k, t, reducedMotion) {
  const phase = reducedMotion ? 0 : (t * 3) % 1;
  ctx.globalAlpha = 1 - (reducedMotion ? t : phase);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3 / k;
  ctx.beginPath(); ctx.arc(n.x, n.y, n.r + (6 + 16 * phase) / k, 0, TAU); ctx.stroke();
}
