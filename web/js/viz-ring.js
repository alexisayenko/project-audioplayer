import { rgba, mixColor } from './viz-color.js';

const TAU = Math.PI * 2;
const DOT_RINGS = [
  { scale: 1.5, count: 40, alpha: 0.38, speed: 1 },
  { scale: 1.8, count: 56, alpha: 0.24, speed: -0.7 },
  { scale: 2.1, count: 72, alpha: 0.12, speed: 0.5 },
];

export function spokeAngles(m) {
  const out = new Float32Array(m);
  for (let i = 0; i < m; i += 1) out[i] = -Math.PI / 2 + ((i + 0.5) * Math.PI) / m;
  return out;
}

export function pulseRadius(r, bass) {
  return r * (1 + 0.08 * Math.min(1, Math.max(0, bass)));
}

function drawSpokes(ctx, cx, cy, r0, values, colors) {
  const m = values.length;
  const angles = spokeAngles(m);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, (Math.PI * r0) / (m * 2.2));
  for (let i = 0; i < m; i += 1) {
    const len = 2 + values[i] * r0 * 0.62;
    ctx.strokeStyle = rgba(mixColor(colors.a, colors.b, i / Math.max(1, m - 1)), 1);
    ctx.beginPath();
    for (const sign of [1, -1]) {
      const a = sign === 1 ? angles[i] : Math.PI - angles[i];
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.moveTo(cx + cos * (r0 + 3), cy + sin * (r0 + 3));
      ctx.lineTo(cx + cos * (r0 + 3 + len), cy + sin * (r0 + 3 + len));
    }
    ctx.stroke();
  }
}

function drawDots(ctx, cx, cy, r0, rot, colors) {
  const dot = Math.max(1, r0 * 0.014);
  for (const ring of DOT_RINGS) {
    ctx.fillStyle = rgba(colors.accent, ring.alpha);
    const rr = r0 * ring.scale;
    ctx.beginPath();
    for (let k = 0; k < ring.count; k += 1) {
      const a = (k / ring.count) * TAU + rot * ring.speed;
      const x = cx + Math.cos(a) * rr;
      ctx.moveTo(x + dot, cy + Math.sin(a) * rr);
      ctx.arc(x, cy + Math.sin(a) * rr, dot, 0, TAU);
    }
    ctx.fill();
  }
}

export function drawRing(ctx, cx, cy, r, values, opts) {
  const { colors, bass = 0, rotation = 0, glow = false, alpha = 1 } = opts;
  if (!(r > 0) || !values.length) return;
  const r0 = pulseRadius(r, bass);
  ctx.save();
  ctx.globalAlpha = alpha;
  const halo = ctx.createRadialGradient(cx, cy, r0 * 0.9, cx, cy, r0 * 2);
  halo.addColorStop(0, rgba(colors.accent, 0.2 + 0.25 * bass));
  halo.addColorStop(1, rgba(colors.accent, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r0 * 2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(colors.scrim, 0.9);
  ctx.beginPath();
  ctx.arc(cx, cy, r0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(colors.accent, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawDots(ctx, cx, cy, r0, rotation, colors);
  ctx.globalCompositeOperation = 'lighter';
  if (glow) { ctx.shadowColor = rgba(colors.a, 0.8); ctx.shadowBlur = 8; }
  drawSpokes(ctx, cx, cy, r0, values, colors);
  ctx.restore();
}
