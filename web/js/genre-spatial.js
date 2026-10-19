const key = (gx, gy) => (gx + 32768) * 65536 + (gy + 32768);

export function createHash(cell = 48) {
  let grid = new Map();
  let maxR = 0;
  return {
    rebuild(nodes, isVisible = () => true) {
      grid = new Map();
      maxR = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!isVisible(n)) continue;
        const k = key(Math.floor(n.x / cell), Math.floor(n.y / cell));
        const list = grid.get(k);
        if (list) list.push(i); else grid.set(k, [i]);
        if (n.r > maxR) maxR = n.r;
      }
      this.nodes = nodes;
    },
    hit(x, y, slack = 0) {
      const reach = Math.ceil((maxR + slack) / cell);
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let best = -1;
      for (let gx = cx - reach; gx <= cx + reach; gx++) {
        for (let gy = cy - reach; gy <= cy + reach; gy++) {
          const list = grid.get(key(gx, gy));
          if (!list) continue;
          for (const i of list) {
            const n = this.nodes[i];
            const dx = n.x - x;
            const dy = n.y - y;
            const rr = n.r + slack;
            if (dx * dx + dy * dy <= rr * rr && i > best) best = i;
          }
        }
      }
      return best < 0 ? null : this.nodes[best];
    },
    size: () => [...grid.values()].reduce((s, l) => s + l.length, 0),
  };
}
