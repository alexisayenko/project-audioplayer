import { arrowHead, clipLink } from './genre-data.js';

export const FADE_STEP = 0.12;
const LIT_ALPHA = 0.95;

const shrunk = (n) => n.r * (0.4 + 0.6 * n.vis);
const fadingAlpha = (l) => 0.3 * Math.min(l.s.vis, l.t.vis);
const farAlpha = (d) => Math.max(0.45, LIT_ALPHA - FADE_STEP * (d - 1));

function bucketLink(b, l, focus) {
  const on = focus?.edges.has(l);
  const d = on ? focus.edgeDepth.get(l) || 1 : 1;
  if (on && d > 1 && !l.assoc) b.litFar.set(d, [...(b.litFar.get(d) || []), l]);
  else if (l.assoc) (on ? b.litDotted : b.dotted).push(l);
  else (on ? b.lit : b.plain).push(l);
}

export function classifyLinks(links, focus) {
  const b = { plain: [], lit: [], litFar: new Map(), dotted: [], litDotted: [], fading: [] };
  for (const l of links) {
    const v = Math.min(l.s.vis, l.t.vis);
    if (v < 0.02) continue;
    if (v < 0.99) b.fading.push(l); else bucketLink(b, l, focus);
  }
  return b;
}

function strokeLinks(ctx, list, k, alpha, color, width, dotted = false) {
  if (!list.length) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width / k;
  ctx.setLineDash(dotted ? [1 / k, 3 / k] : []);
  ctx.beginPath();
  for (const l of list) {
    const c = clipLink(l.s.x, l.s.y, shrunk(l.s), l.t.x, l.t.y, shrunk(l.t));
    if (c) { ctx.moveTo(c.x1, c.y1); ctx.lineTo(c.x2, c.y2); }
  }
  ctx.stroke();
}

function arrowLinks(ctx, list, k, alpha, color) {
  let any = false;
  for (const l of list) {
    if (l.related) continue;
    const a = arrowHead(l.s.x, l.s.y, l.s.r, l.t.x, l.t.y, shrunk(l.t), k);
    if (!a) continue;
    if (!any) { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); any = true; }
    ctx.moveTo(a.tx, a.ty); ctx.lineTo(a.ax, a.ay); ctx.lineTo(a.bx, a.by); ctx.closePath();
  }
  if (any) ctx.fill();
}

function strokeAll(ctx, b, k, base, colors) {
  strokeLinks(ctx, b.plain, k, base, colors.edge, 1);
  for (const l of b.fading) strokeLinks(ctx, [l], k, fadingAlpha(l), colors.edge, 1, l.assoc);
  strokeLinks(ctx, b.dotted, k, base * 0.8, colors.edge, 0.7, true);
  strokeLinks(ctx, b.lit, k, LIT_ALPHA, colors.accent, 1.8);
  for (const [d, list] of b.litFar) strokeLinks(ctx, list, k, farAlpha(d), colors.accent, 1.8);
  strokeLinks(ctx, b.litDotted, k, LIT_ALPHA, colors.accent, 1.2, true);
}

function arrowAll(ctx, b, k, base, colors) {
  arrowLinks(ctx, b.plain, k, base, colors.edge);
  for (const l of b.fading) if (!l.assoc) arrowLinks(ctx, [l], k, fadingAlpha(l), colors.edge);
  arrowLinks(ctx, b.lit, k, LIT_ALPHA, colors.accent);
  for (const [d, list] of b.litFar) arrowLinks(ctx, list, k, farAlpha(d), colors.accent);
}

export function drawLinks(ctx, links, focus, colors, k) {
  const b = classifyLinks(links, focus);
  const base = focus ? 0.06 : 0.2;
  strokeAll(ctx, b, k, base, colors);
  ctx.setLineDash([]);
  arrowAll(ctx, b, k, base, colors);
}
