import { GLOW_TIGHT_ALPHA, GLOW_WIDE_ALPHA } from './viz-constants.js';

export function glowScale(glow) {
  if (glow === 'full' || glow === 'tight') return 0.5;
  if (glow === 'halo') return 0.25;
  return 0;
}

export function glowSize(canvasW, canvasH, glow) {
  const s = glowScale(glow);
  if (!s) return { w: 0, h: 0, scale: 0 };
  return { w: Math.max(1, Math.round(canvasW * s)), h: Math.max(1, Math.round(canvasH * s)), scale: s };
}

function blurInto(l, source, srcW, srcH, w, h, blurPx) {
  const c = l.octx;
  c.setTransform?.(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.clearRect(0, 0, w, h);
  c.filter = `blur(${blurPx}px)`;
  c.drawImage(source, 0, 0, srcW, srcH, 0, 0, w, h);
  c.filter = 'none';
}

function composite(ctx, l, w, h, cssW, cssH, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(l.off, 0, 0, w, h, 0, 0, cssW, cssH);
  ctx.restore();
}

export function createGlow(makeCanvas) {
  const layers = {};

  function layer(name, w, h) {
    let l = layers[name];
    if (!l) {
      const off = makeCanvas?.() ?? null;
      l = { off, octx: off?.getContext?.('2d') ?? null };
      layers[name] = l;
    }
    if (!l.octx) return null;
    if (l.off.width !== w || l.off.height !== h) { l.off.width = w; l.off.height = h; }
    return l;
  }

  return {
    apply(ctx, canvas, cssW, cssH, glow) {
      const size = glowSize(canvas.width, canvas.height, glow);
      if (!size.scale || !makeCanvas) return false;
      const tight = layer('tight', size.w, size.h);
      if (!tight || !('filter' in tight.octx)) return false;
      blurInto(tight, canvas, canvas.width, canvas.height, size.w, size.h, glow === 'halo' ? 1 : 2);
      composite(ctx, tight, size.w, size.h, cssW, cssH, GLOW_TIGHT_ALPHA);
      if (glow !== 'full') return true;
      const ww = Math.max(1, Math.round(size.w / 2));
      const wh = Math.max(1, Math.round(size.h / 2));
      const wide = layer('wide', ww, wh);
      if (!wide || !('filter' in wide.octx)) return true;
      blurInto(wide, tight.off, size.w, size.h, ww, wh, 2);
      composite(ctx, wide, ww, wh, cssW, cssH, GLOW_WIDE_ALPHA);
      return true;
    },
    dispose() { for (const k of Object.keys(layers)) delete layers[k]; },
  };
}
