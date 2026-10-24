export function bounds(list) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const n of list) {
    if (n.x - n.r < x0) x0 = n.x - n.r;
    if (n.x + n.r > x1) x1 = n.x + n.r;
    if (n.y - n.r < y0) y0 = n.y - n.r;
    if (n.y + n.r > y1) y1 = n.y + n.r;
  }
  return { x0, y0, x1, y1 };
}

export function unpin(n) {
  n.fx = null;
  n.fy = null;
}

export function shiftNode(c, dx, dy) {
  if (c.hx !== undefined) { c.hx += dx; c.hy += dy; }
  if (c.target !== 1) return;
  c.x += dx; c.y += dy;
  c.fx = c.x; c.fy = c.y;
}
