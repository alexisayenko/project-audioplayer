import {
  GRID_DEPTH, GRID_MAX_VERTICES, LOD_ROW_PX, LOD_MERGE, LOD_MAX_SPACING, tierHalfWidth, crossAlpha,
} from './viz-terrain-math.js';

export const crossAlphaFor = crossAlpha;
const MAX_TIERS = 12;
const BASE_MIN = 0.2;
const BASE_MAX = 1.2;
const REBUILD_STEP = 1.08;

function planTiers(base, level, aspect, nowZ) {
  const merge = level >= 2 ? LOD_MERGE : LOD_MERGE * 0.85;
  const tiers = [];
  let z0 = 0;
  for (let k = 0; z0 < GRID_DEPTH - 1e-6 && k < MAX_TIERS; k += 1) {
    const nominal = base * 2 ** k;
    let z1 = Math.sqrt(nominal * LOD_ROW_PX);
    if (z1 >= merge * GRID_DEPTH || nominal * 2 > LOD_MAX_SPACING) z1 = GRID_DEPTH;
    z1 = Math.max(z1, Math.min(GRID_DEPTH, z0 + nominal));
    const last = z1 >= GRID_DEPTH;
    const sp = nominal;
    const half = Math.ceil(tierHalfWidth(z1, aspect, 0, k === 0) / sp);
    const jz0 = Math.floor((z0 - nowZ) / sp);
    const rows = Math.ceil((z1 - nowZ) / sp) - jz0 + 1;
    tiers.push({
      k, z0, z1, zA: z0, zB: z1,
      fade: [k === 0 ? -2 : z0, k === 0 ? -1 : z0, last ? GRID_DEPTH + 2 : z1, last ? GRID_DEPTH + 3 : z1],
      phw: k === 0 ? 0 : tiers[k - 1].hw,
      spacing: sp, dz: sp, dx: sp, hw: half * sp, rows, cols: 2 * half + 1, jz0,
    });
    z0 = z1;
  }
  return tiers;
}

export function synthTiers(p, level, aspect, nowZ) {
  const lvl = Number.isFinite(level) ? level : 1;
  const a = Number.isFinite(aspect) ? aspect : 1.78;
  const nz = Number.isFinite(nowZ) ? nowZ : 0;
  let base = Math.min(BASE_MAX, Math.max(BASE_MIN, Number.isFinite(p?.cell) ? p.cell : 0.6));
  let tiers = planTiers(base, lvl, a, nz);
  for (let i = 0; i < 60 && tiers.reduce((s, t) => s + t.rows * t.cols, 0) > GRID_MAX_VERTICES; i += 1) {
    base *= REBUILD_STEP;
    tiers = planTiers(base, lvl, a, nz);
  }
  return tiers;
}

export function buildMesh(tier, style) {
  const { rows, cols } = tier;
  const half = (cols - 1) / 2;
  const n = rows * cols;
  const tri = style === 'triangle';
  const xz = new Float32Array(n * 2);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = (r * cols + c) * 2;
      xz[i] = (c - half) * tier.dx;
      xz[i + 1] = (r + tier.jz0) * tier.dz;
    }
  }
  const cells = (rows - 1) * (cols - 1);
  const nLines = cols * (rows - 1) + rows * (cols - 1) + (tri ? cells : 0);
  const Idx = n > 65535 ? Uint32Array : Uint16Array;
  const lines = new Idx(nLines * 2);
  const tris = new Idx(cells * 6);
  let l = 0;
  let t = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (r < rows - 1) { lines[l++] = i; lines[l++] = i + cols; }
      if (c < cols - 1) { lines[l++] = i; lines[l++] = i + 1; }
      if (r < rows - 1 && c < cols - 1) {
        const flip = tri && ((r + c) & 1) === 1;
        const a = i;
        const b = i + 1;
        const d = i + cols;
        const e = i + cols + 1;
        if (flip) {
          lines[l++] = b; lines[l++] = d;
          tris[t++] = a; tris[t++] = d; tris[t++] = b;
          tris[t++] = b; tris[t++] = d; tris[t++] = e;
        } else {
          if (tri) { lines[l++] = a; lines[l++] = e; }
          tris[t++] = a; tris[t++] = d; tris[t++] = e;
          tris[t++] = a; tris[t++] = e; tris[t++] = b;
        }
      }
    }
  }
  return { xz, lines, tris, lineCount: nLines, triCount: cells * 2, rows, cols, vertices: n };
}
