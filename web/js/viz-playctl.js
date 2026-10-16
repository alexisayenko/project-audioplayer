import { setIcon, setToggle } from './player-ui.js';
import { stepVolume, volumePercent, volumeAnnounce, nextRepeatLabel, playHotkey } from './volume-logic.js';

export function initOverlayPlayControls({ player, audio, root, live, isOpen }) {
  const say = (t) => { if (live) live.textContent = t; };
  const slider = root.querySelector('#viz-volume');
  const mute = root.querySelector('#viz-mute');
  const shuffleBtn = root.querySelector('#viz-shuffle');
  const repeatBtn = root.querySelector('#viz-repeat');
  if (!slider || !mute || !shuffleBtn || !repeatBtn) return null;

  const paintTransport = () => {
    setToggle(['viz-shuffle'], player.shuffleOn, `Shuffle: ${player.shuffleOn ? 'on' : 'off'}`, 'shuffle');
    const mode = player.repeatMode;
    setToggle(['viz-repeat'], mode !== 'off', nextRepeatLabel(mode), mode === 'one' ? 'repeatOne' : 'repeat');
  };
  const paintVolume = () => {
    const v = audio.volume;
    const silent = audio.muted || v === 0;
    slider.value = String(Math.round(v * 100) / 100);
    slider.style.setProperty('--p', v.toFixed(3));
    slider.setAttribute('aria-valuetext', `${volumePercent(v)}%`);
    mute.setAttribute('aria-pressed', String(silent));
    const label = silent ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-label', label);
    mute.title = label;
    mute.classList.toggle('on', silent);
    mute.replaceChildren();
    setIcon('viz-mute', silent ? 'volumeMute' : 'volume', 'nav');
  };

  const shuffle = () => { player.setShuffle(!player.shuffleOn); say(`Shuffle ${player.shuffleOn ? 'on' : 'off'}`); };
  const repeat = () => { player.cycleRepeat(); say(nextRepeatLabel(player.repeatMode)); };
  const nudge = (dir) => { player.setVolume(stepVolume(audio.muted ? 0 : audio.volume, dir)); say(volumeAnnounce(audio.volume, false)); };

  shuffleBtn.addEventListener('click', shuffle);
  repeatBtn.addEventListener('click', repeat);
  mute.addEventListener('click', () => { player.toggleMute(); say(volumeAnnounce(audio.volume, audio.muted)); });
  slider.addEventListener('input', () => player.setVolume(Number(slider.value)));
  root.querySelector('#viz-vol')?.addEventListener('wheel', (e) => {
    e.preventDefault();
    nudge(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    const act = playHotkey(e, { open: isOpen() });
    if (!act) return;
    e.preventDefault();
    if (act === 'shuffle') shuffle();
    else if (act === 'repeat') repeat();
    else nudge(act === 'vol-up' ? 1 : -1);
  });

  setIcon('viz-shuffle', 'shuffle', 'nav');
  setIcon('viz-repeat', 'repeat', 'nav');
  player.onChange(paintTransport);
  audio.addEventListener('volumechange', paintVolume);
  paintTransport();
  paintVolume();
  return { paintTransport, paintVolume };
}
