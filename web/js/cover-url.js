import { api } from './api.js';
import { el } from './dom.js';
import { queueCover, queueCovers, dropCover, loadCoverNow } from './cover-loader.js';

export const COVER_SIZES = [96, 192, 320];
export const ROW_PX = 84;
export const QUEUE_PX = 60;
export const MINI_PX = 66;
export const SMALL_PX = 40;

// Smallest server thumbnail that still looks sharp at `px` CSS pixels on this screen (a thumbnail is a square centre-crop).
export function thumbSize(px, dpr = globalThis.devicePixelRatio || 1) {
  const need = px * Math.min(dpr, 3) * 0.9;
  return COVER_SIZES.find((s) => s >= need) ?? COVER_SIZES[COVER_SIZES.length - 1];
}

export const coverUrl = (song, px, dpr) => api.coverUrl(song.id, song.cover_v, thumbSize(px, dpr));

const SCREENS_AHEAD = 1.5;
let watcher;
const observed = new WeakMap();
const targetImg = new WeakMap();
const cancelled = new WeakSet();

function unobserve(img) {
  const target = observed.get(img);
  if (target) watcher?.unobserve(target);
  observed.delete(img);
}

// Starts loading now (first screen of rows), ahead of the queue.
export function revealCovers(imgs) {
  imgs.forEach((img) => {
    cancelled.add(img);
    unobserve(img);
  });
  queueCovers(imgs, { front: true });
}

export const revealCover = (img) => revealCovers([img]);

export function unwatchCover(img) {
  cancelled.add(img);
  unobserve(img);
  dropCover(img);
}

function onSeen(entries) {
  for (const e of entries) {
    const img = targetImg.get(e.target) || e.target;
    if (e.isIntersecting) queueCover(img);
    else dropCover(img);
  }
}

// An <img> without a src is display:none, which an IntersectionObserver never reports, so the row's cover box is observed instead (the img itself when it has no parent).
function observeLater(img) {
  queueMicrotask(() => {
    if (cancelled.has(img) || observed.has(img)) return;
    const target = img.parentElement || img;
    observed.set(img, target);
    targetImg.set(target, img);
    watcher.observe(target);
  });
}

// Long lists are not windowed, so the browser's own lazy-load distance (up to 2500 px, more in Safari) cannot bound the requests: with `defer` the image gets its src only within about 1.5 screens of the viewport, at most a few at a time, and not while a song is starting.
function watchCover(img) {
  if (watcher === undefined) {
    const ahead = Math.round((globalThis.innerHeight || 800) * SCREENS_AHEAD);
    watcher = typeof globalThis.IntersectionObserver === 'function' ? new globalThis.IntersectionObserver(onSeen, { rootMargin: `${ahead}px 0px` }) : null;
  }
  if (!watcher) return false;
  observeLater(img);
  return true;
}

// List thumbnail: low priority, lazy, async-decoded, sized up front; the caller's CSS decides the shown size. Hides itself when the file is missing.
// `defer`: loaded through the cover queue. `exempt`: the current song's cover, loaded at once.
export function thumbImg(song, px, { defer = false, exempt = false } = {}) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy', decoding: 'async', fetchpriority: 'low', width: px, height: px });
  if (song?.cover) {
    const url = coverUrl(song, px);
    if (defer || exempt) img.dataset.src = url;
    if (exempt) loadCoverNow(img);
    else if (!defer || !watchCover(img)) img.src = url;
  }
  img.addEventListener('error', () => {
    img.removeAttribute('src');
    delete img.dataset.src;
  });
  return img;
}
