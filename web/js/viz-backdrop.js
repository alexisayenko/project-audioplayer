import { rgba } from './viz-color.js';
import { BACKDROP_RADIUS, BACKDROP_ALPHA, BACKDROP_SPOKES } from './viz-constants.js';

const TAU = Math.PI * 2;

export function spokeSegments(cx, cy, r, count = BACKDROP_SPOKES) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU;
    const len = r * (i % 4 === 0 ? 0.3 : 0.16);
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([cx + c * (r - len / 2), cy + s * (r - len / 2), cx + c * (r + len / 2), cy + s * (r + len / 2)]);
  }
  return out;
}

export function createBackdrop(makeCanvas) {
  let off = null;
  let octx = null;
  let key = '';

  function render(w, h, colors) {
    const k = `${w}|${h}|${colors.accent}`;
    if (k === key) return;
    key = k;
    octx.setTransform?.(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, off.width, off.height);
    octx.setTransform?.(off.width / w, 0, 0, off.height / h, 0, 0);
    const r = h * BACKDROP_RADIUS;
    const ring = octx.createRadialGradient(w / 2, h / 2, r * 0.7, w / 2, h / 2, r * 1.5);
    ring.addColorStop(0, rgba(colors.accent, 0));
    ring.addColorStop(0.4, rgba([200, 160, 255], 0.35));
    ring.addColorStop(1, rgba(colors.accent, 0));
    octx.fillStyle = ring;
    octx.fillRect(0, 0, w, h);
    octx.strokeStyle = rgba([235, 225, 255], 0.9);
    octx.lineWidth = 1;
    octx.beginPath();
    for (const [x0, y0, x1, y1] of spokeSegments(w / 2, h / 2, r)) { octx.moveTo(x0, y0); octx.lineTo(x1, y1); }
    octx.stroke();
  }

  return {
    draw(ctx, w, h, colors, bass = 0) {
      if (!makeCanvas || !(w > 0) || !(h > 0)) return false;
      if (!off) { off = makeCanvas(); octx = off?.getContext?.('2d') ?? null; }
      if (!octx) return false;
      const ow = Math.max(1, Math.round(w / 2));
      const oh = Math.max(1, Math.round(h / 2));
      if (off.width !== ow || off.height !== oh) { off.width = ow; off.height = oh; key = ''; }
      render(w, h, colors);
      ctx.save();
      ctx.globalAlpha = BACKDROP_ALPHA * (1 + 0.6 * Math.min(1, Math.max(0, bass)));
      ctx.drawImage(off, 0, 0, ow, oh, 0, 0, w, h);
      ctx.restore();
      return true;
    },
    dispose() { off = null; octx = null; key = ''; },
  };
}
