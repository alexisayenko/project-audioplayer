const cross = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);

export function segmentsCross(...[ax, ay, bx, by, cx, cy, dx, dy]) {
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function buildGrid(xs, ys, segs, cell) {
  const grid = new Map();
  for (let s = 0; s < segs.length; s++) {
    const a = segs[s][0];
    const b = segs[s][1];
    const x0 = Math.floor(Math.min(xs[a], xs[b]) / cell);
    const x1 = Math.floor(Math.max(xs[a], xs[b]) / cell);
    const y0 = Math.floor(Math.min(ys[a], ys[b]) / cell);
    const y1 = Math.floor(Math.max(ys[a], ys[b]) / cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = (gx + 4096) * 8192 + (gy + 4096);
        const list = grid.get(k);
        if (list) list.push(s); else grid.set(k, [s]);
      }
    }
  }
  return grid;
}

export function countCrossingsXY(xs, ys, segs, cell = 90) {
  const grid = buildGrid(xs, ys, segs, cell);
  const n = segs.length;
  const seen = new Set();
  let count = 0;
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = list[i] * n + list[j];
        if (seen.has(key)) continue;
        seen.add(key);
        const [a, b] = segs[list[i]];
        const [c, d] = segs[list[j]];
        if (a === c || a === d || b === c || b === d) continue;
        if (segmentsCross(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], xs[d], ys[d])) count++;
      }
    }
  }
  return count;
}

const COUNTED = new Set(['parent', 'related']);

export function countCrossings(nodes, links, kinds = COUNTED) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const xs = Float64Array.from(nodes, (n) => n.x);
  const ys = Float64Array.from(nodes, (n) => n.y);
  const segs = [];
  for (const l of links) {
    if (!kinds.has(l.kind)) continue;
    const a = idx.get(l.source?.id ?? l.source);
    const b = idx.get(l.target?.id ?? l.target);
    if (a !== undefined && b !== undefined && a !== b) segs.push([a, b]);
  }
  return countCrossingsXY(xs, ys, segs);
}
