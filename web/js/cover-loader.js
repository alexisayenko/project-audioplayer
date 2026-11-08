// Gives list covers their real src a few at a time, and not at all while a song is starting, so covers never delay the audio.
export const MAX_CONCURRENT = 3;
export const PAUSE_TIMEOUT_MS = 8000;
export const SLOT_TIMEOUT_MS = 10000;

const queue = [];
const slots = new Map();
let paused = false;
let pauseTimer = null;

const wanted = (img) => img.dataset?.src;

function release(img) {
  const slot = slots.get(img);
  if (!slot) return;
  slots.delete(img);
  clearTimeout(slot.timer);
  img.removeEventListener('load', slot.done);
  img.removeEventListener('error', slot.done);
  pump();
}

function start(img) {
  const done = () => release(img);
  const slot = { done, timer: setTimeout(done, SLOT_TIMEOUT_MS) };
  slots.set(img, slot);
  img.addEventListener('load', done);
  img.addEventListener('error', done);
  img.src = wanted(img);
}

function pump() {
  while (!paused && slots.size < MAX_CONCURRENT && queue.length) {
    const img = queue.shift();
    if (img.isConnected === false || !wanted(img) || img.getAttribute('src') === wanted(img)) continue;
    start(img);
  }
}

function enqueue(img, front) {
  if (!wanted(img) || slots.has(img) || img.getAttribute('src') === wanted(img)) return null;
  const at = queue.indexOf(img);
  if (at >= 0) {
    if (!front) return null;
    queue.splice(at, 1);
  }
  return img;
}

// An image is loaded in turn; `front` puts it ahead of the others (rows on the first screen).
export function queueCover(img, { front = false } = {}) {
  queueCovers([img], { front });
}

export function queueCovers(imgs, { front = false } = {}) {
  const fresh = imgs.filter((img) => enqueue(img, front));
  if (front) queue.unshift(...fresh); else queue.push(...fresh);
  pump();
}

// A row that scrolled far away before its turn is not loaded at all.
export function dropCover(img) {
  const at = queue.indexOf(img);
  if (at >= 0) queue.splice(at, 1);
}

// Covers of the song that is playing are tiny and needed at once: they skip the queue and the pause.
export function loadCoverNow(img) {
  dropCover(img);
  if (wanted(img) && img.getAttribute('src') !== wanted(img)) img.src = wanted(img);
}

export function pauseCovers(ms = PAUSE_TIMEOUT_MS) {
  paused = true;
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(resumeCovers, ms);
}

export function resumeCovers() {
  clearTimeout(pauseTimer);
  pauseTimer = null;
  paused = false;
  pump();
}

// Pause while the media element starts a new source; resume when it can play (or errors, or after the timeout).
export function watchMedia(audio) {
  audio.addEventListener('loadstart', () => pauseCovers());
  for (const ev of ['canplay', 'playing', 'error', 'emptied', 'abort']) audio.addEventListener(ev, resumeCovers);
}

export const coverLoadState = () => ({ paused, loading: slots.size, waiting: queue.length });

export function resetCoverLoader() {
  for (const img of [...slots.keys()]) release(img);
  queue.length = 0;
  resumeCovers();
}
