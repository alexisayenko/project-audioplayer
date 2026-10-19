export const uniqueIndices = (names, indexOf) => {
  const out = [];
  for (const f of names) {
    const i = indexOf(f);
    if (!out.includes(i)) out.push(i);
  }
  return out;
};

export function fillDisc(ctx, x, y, r, palette, idx, fallback, shadeIdx = -1, shade = null) {
  const col = (i) => (i === shadeIdx && shade ? shade : palette[i] || fallback);
  if (idx.length < 2) {
    ctx.fillStyle = col(idx[0]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    return;
  }
  const step = (2 * Math.PI) / idx.length;
  for (let i = 0; i < idx.length; i++) {
    const a0 = -Math.PI / 2 + i * step;
    ctx.fillStyle = col(idx[i]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, a0, a0 + step); ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
}
