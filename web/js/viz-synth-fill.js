export function newFill() {
  return { px: 0, quads: 0 };
}

export function clipRect(res, x0, y0, x1, y1) {
  const w = res[0];
  const h = res[1];
  const a = Math.max(0, Math.floor(Number.isFinite(x0) ? x0 : 0));
  const b = Math.max(0, Math.floor(Number.isFinite(y0) ? y0 : 0));
  const c = Math.min(w, Math.ceil(Number.isFinite(x1) ? x1 : w));
  const d = Math.min(h, Math.ceil(Number.isFinite(y1) ? y1 : h));
  if (!(c > a) || !(d > b)) return null; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
  return { x: a, y: b, w: c - a, h: d - b };
}

export function beginRect(gl, scene, x0, y0, x1, y1) {
  const r = clipRect(scene.res, x0, y0, x1, y1);
  if (!r) return false;
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(r.x, scene.res[1] - r.y - r.h, r.w, r.h);
  if (scene.fill) {
    scene.fill.px += r.w * r.h;
    scene.fill.quads += 1;
  }
  return true;
}

export function endRect(gl) {
  gl.disable(gl.SCISSOR_TEST);
}

export function countFull(scene) {
  if (scene.fill) {
    scene.fill.px += scene.res[0] * scene.res[1];
    scene.fill.quads += 1;
  }
}

export function countArea(scene, px) {
  if (scene.fill) {
    scene.fill.px += Math.max(0, px);
    scene.fill.quads += 1;
  }
}
