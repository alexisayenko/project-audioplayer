export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const VELOCITY_DECAY = 0.4;
const THETA2 = 0.81;
const MAX_V = 40;

function opens(c, d2) {
  return Boolean(c.kids) && (d2 === 0 || (c.size * c.size) / d2 >= THETA2);
}

function clampV(v) {
  return Math.max(-MAX_V, Math.min(MAX_V, v));
}

const REST = 0.012;

function quad(x0, y0, size) {
  return { x0, y0, size, mass: 0, cx: 0, cy: 0, kids: null, leaf: null };
}

function insert(cell, n, w, depth = 0) {
  const total = cell.mass + w;
  cell.cx = (cell.cx * cell.mass + n.x * w) / total;
  cell.cy = (cell.cy * cell.mass + n.y * w) / total;
  cell.mass = total;
  if (!cell.kids && cell.leaf === null) { cell.leaf = [n, w]; return; }
  if (!cell.kids) {
    if (depth > 24) { cell.leaf.push(n, w); return; }
    const old = cell.leaf;
    cell.leaf = null;
    cell.kids = [null, null, null, null];
    cell.mass = 0; cell.cx = 0; cell.cy = 0;
    for (let i = 0; i < old.length; i += 2) insert(cell, old[i], old[i + 1], depth + 1);
    insert(cell, n, w, depth + 1);
    return;
  }
  const h = cell.size / 2;
  const right = n.x >= cell.x0 + h ? 1 : 0;
  const down = n.y >= cell.y0 + h ? 1 : 0;
  const i = down * 2 + right;
  if (!cell.kids[i]) cell.kids[i] = quad(cell.x0 + right * h, cell.y0 + down * h, h);
  insert(cell.kids[i], n, w, depth + 1);
}

export function createSim({ nodes, links = [], seed = 1, breathing = true, charge = 70, linkDistance = 56, gravity = 0.035 }) {
  const rng = mulberry32(seed);
  const byId = new Map();
  nodes.forEach((n, i) => {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      const rad = 12 * Math.sqrt(0.5 + i);
      const ang = i * Math.PI * (3 - Math.sqrt(5));
      n.x = rad * Math.cos(ang) + (rng() - 0.5) * 2;
      n.y = rad * Math.sin(ang) + (rng() - 0.5) * 2;
    }
    n.vx = n.vx || 0;
    n.vy = n.vy || 0;
    n.fx = n.fx ?? null;
    n.fy = n.fy ?? null;
    n.r = n.r || 6;
    n.phase = rng() * Math.PI * 2;
    byId.set(n.id, n);
  });
  const ls = [];
  const deg = new Map(nodes.map((n) => [n.id, 0]));
  for (const l of links) {
    const s = byId.get(l.source?.id ?? l.source);
    const t = byId.get(l.target?.id ?? l.target);
    if (!s || !t || s === t) continue;
    ls.push({ s, t, related: l.kind === 'related' });
    deg.set(s.id, deg.get(s.id) + 1);
    deg.set(t.id, deg.get(t.id) + 1);
  }
  for (const l of ls) {
    const ds = deg.get(l.s.id);
    const dt = deg.get(l.t.id);
    l.strength = (l.related ? 0.15 : 1) / Math.min(ds, dt);
    l.dist = (l.related ? 1.6 : 1) * linkDistance + l.s.r + l.t.r;
    l.bias = ds / (ds + dt);
  }
  const weight = (n) => 1 + n.r * 0.12;
  let alpha = 1;
  let alphaTarget = breathing ? REST : 0;
  let ticks = 0;

  function linkForce() {
    for (const l of ls) {
      const { s, t } = l;
      let dx = t.x + t.vx - s.x - s.vx || (rng() - 0.5) * 1e-4;
      let dy = t.y + t.vy - s.y - s.vy || (rng() - 0.5) * 1e-4;
      const d = Math.hypot(dx, dy) || 1e-6;
      const k = ((d - l.dist) / d) * alpha * l.strength;
      dx *= k; dy *= k;
      t.vx -= dx * (1 - l.bias); t.vy -= dy * (1 - l.bias);
      s.vx += dx * l.bias; s.vy += dy * l.bias;
    }
  }

  function bounds() {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
      y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
    }
    return { x0, y0, x1, y1 };
  }

  function leafForce(n, c) {
    for (let i = 0; i < c.leaf.length; i += 2) {
      const o = c.leaf[i];
      if (o === n) continue;
      let ex = o.x - n.x; let ey = o.y - n.y;
      let e2 = ex * ex + ey * ey;
      if (e2 === 0) { ex = (rng() - 0.5) * 1e-3; ey = (rng() - 0.5) * 1e-3; e2 = ex * ex + ey * ey; }
      if (e2 < 25) e2 = Math.sqrt(25 * e2);
      const f = (charge * alpha * c.leaf[i + 1]) / e2;
      n.vx -= ex * f; n.vy -= ey * f;
    }
  }

  function chargeOn(n, root) {
    const stack = [root];
    while (stack.length) {
      const c = stack.pop();
      if (!c.mass) continue;
      const dx = c.cx - n.x;
      const dy = c.cy - n.y;
      let d2 = dx * dx + dy * dy;
      if (opens(c, d2)) {
        stack.push(...c.kids.filter(Boolean));
        continue;
      }
      if (c.leaf) {
        leafForce(n, c);
        continue;
      }
      if (d2 < 25) d2 = Math.sqrt(25 * d2);
      const f = (charge * alpha * c.mass) / d2;
      n.vx -= dx * f; n.vy -= dy * f;
    }
  }

  function chargeForce() {
    if (!nodes.length) return;
    const { x0, y0, x1, y1 } = bounds();
    const size = Math.max(x1 - x0, y1 - y0, 1) + 1;
    const root = quad(x0, y0, size);
    for (const n of nodes) insert(root, n, weight(n));
    for (const n of nodes) chargeOn(n, root);
  }

  function collidePair(a, b) {
    let dx = b.x + b.vx - a.x - a.vx;
    let dy = b.y + b.vy - a.y - a.vy;
    const min = a.r + b.r + 4;
    let d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    if (d2 === 0) { dx = (rng() - 0.5) * 1e-3; dy = (rng() - 0.5) * 1e-3; d2 = dx * dx + dy * dy; }
    const d = Math.sqrt(d2);
    const push = ((min - d) / d) * 0.7;
    const wa = (b.r * b.r) / (a.r * a.r + b.r * b.r);
    a.vx -= dx * push * wa; a.vy -= dy * push * wa;
    b.vx += dx * push * (1 - wa); b.vy += dy * push * (1 - wa);
  }

  function collideForce() {
    let maxR = 0;
    for (const n of nodes) {
      if (n.r > maxR) maxR = n.r;
    }
    const cell = 2 * maxR + 8;
    const grid = new Map();
    for (const n of nodes) {
      const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
      const list = grid.get(key);
      if (list) list.push(n); else grid.set(key, [n]);
    }
    for (const a of nodes) collideNear(a, grid, cell);
  }

  function collideNear(a, grid, cell) {
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const b of grid.get(`${gx},${gy}`) ?? []) {
          if (b.id > a.id) collidePair(a, b);
        }
      }
    }
  }

  function integrate(n, amp) {
    n.vx -= n.x * gravity * alpha;
    n.vy -= n.y * gravity * alpha;
    if (amp) {
      n.vx += Math.cos(ticks * 0.021 + n.phase) * amp;
      n.vy += Math.sin(ticks * 0.017 + n.phase * 1.7) * amp;
    }
    if (n.fx == null) {
      n.vx = clampV(n.vx * (1 - VELOCITY_DECAY));
      n.x += n.vx;
    } else { n.x = n.fx; n.vx = 0; }
    if (n.fy == null) {
      n.vy = clampV(n.vy * (1 - VELOCITY_DECAY));
      n.y += n.vy;
    } else { n.y = n.fy; n.vy = 0; }
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) { n.x = (rng() - 0.5) * 10; n.y = (rng() - 0.5) * 10; n.vx = 0; n.vy = 0; }
  }

  function tick() {
    if (alphaTarget === 0 && alpha < ALPHA_MIN) return false;
    alpha += (alphaTarget - alpha) * ALPHA_DECAY;
    ticks++;
    linkForce();
    chargeForce();
    collideForce();
    const amp = breathing ? 0.02 : 0;
    for (const n of nodes) integrate(n, amp);
    return true;
  }

  return {
    nodes,
    links: ls,
    tick,
    get alpha() { return alpha; },
    set alpha(v) { alpha = v; },
    setAlphaTarget(v) { alphaTarget = v; },
    restTarget: () => (breathing ? REST : 0),
    reheat(a = 0.5) { alpha = Math.max(alpha, a); },
    settle(n = 300) {
      const was = alphaTarget;
      alphaTarget = 0;
      for (let i = 0; i < n; i++) {
        if (!tick()) break;
      }
      alphaTarget = was;
      if (alphaTarget > 0 && alpha < alphaTarget) alpha = alphaTarget;
    },
    energy() {
      let e = 0;
      for (const n of nodes) e += n.vx * n.vx + n.vy * n.vy;
      return e;
    },
  };
}
