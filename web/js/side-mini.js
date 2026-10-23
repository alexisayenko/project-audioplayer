import { $, setIcon, setCover } from './player-ui.js';
import { marquee } from './marquee.js';
import { titleLine, artistLine, titleNodes, tooltipLine } from './credits.js';

export function paintSideMini(song, playing) {
  const name = titleLine(song);
  const artist = artistLine(song);
  const label = `${playing ? 'Pause' : 'Play'}: ${[name, artist].filter(Boolean).join(' - ')}`;
  const play = $('side-mini-play');
  play.setAttribute('aria-label', label);
  play.title = label;
  setIcon('side-mini-icon', playing ? 'pause' : 'play', 'action');
  const tip = tooltipLine(song);
  if ($('side-mini-title').title !== tip) {
    $('side-mini-title').replaceChildren(...titleNodes(song));
    $('side-mini-title').title = tip;
    marquee($('side-mini-title'), { auto: true });
  }
  setCover($('side-mini-cover'), song);
}

export function ringValue(cur, dur) {
  if (!Number.isFinite(cur) || !Number.isFinite(dur) || dur <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, cur / dur)) * 200) / 2;
}

let lastRing = -1;

export function paintSideRing(cur, dur) {
  const v = ringValue(cur, dur);
  if (v === lastRing) return;
  lastRing = v;
  $('side-mini-play').style.setProperty('--ring-p', String(v));
}

export function initSideMini({ toggle, openCard }) {
  $('side-mini-play').addEventListener('click', toggle);
  $('side-mini-open').addEventListener('click', openCard);
  const cover = $('side-mini-cover');
  cover.addEventListener('error', () => { cover.removeAttribute('src'); cover.dataset.src = ''; });
}
