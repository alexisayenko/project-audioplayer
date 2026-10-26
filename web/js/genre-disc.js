export const uniqueIndices = (names, indexOf) => {
  const out = [];
  for (const f of names) {
    const i = indexOf(f);
    if (!out.includes(i)) out.push(i);
  }
  return out;
};

const FULL = 2 * Math.PI;

export function segmentsFor(idx, start = -Math.PI / 2) {
  if (!idx || idx.length < 2) return [{ idx: idx?.[0], a0: 0, a1: FULL }];
  const step = FULL / idx.length;
  return idx.map((i, n) => ({ idx: i, a0: start + n * step, a1: start + (n + 1) * step }));
}

export function fillDisc(ctx, { x, y, r }, palette, idx, fallback, shadeIdx = -1, shade = null) {
  const single = idx.length < 2;
  const col = (i) => (single && i === shadeIdx && shade ? shade : palette[i] || fallback);
  if (single) {
    ctx.fillStyle = col(idx[0]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, FULL); ctx.fill();
    return;
  }
  for (const seg of segmentsFor(idx)) {
    ctx.fillStyle = col(seg.idx);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, seg.a0, seg.a1); ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, FULL);
}

export const OUTLINE_WIDTH = 1.25;

export function outlineDisc(ctx, { x, y, r }, idx, isOutlined, color, k = 1) {
  if (!color || !idx.some(isOutlined)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = OUTLINE_WIDTH / k;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
}
