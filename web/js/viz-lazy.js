import { isVizKey } from './viz-keys.js';
import { setIcon } from './player-ui.js';

export function lazyVisualizer({ player, load = () => import('./viz-ui.js'), audio = document.getElementById('audio'), button = document.getElementById('mini-viz') }) {
  let loading = null;
  let ready = null;
  let opening = false;
  const ensure = () => {
    loading ??= load().then((mod) => {
      detach();
      ready = mod.initVisualizer({ player });
      return ready;
    }, (err) => {
      loading = null;
      throw err;
    });
    return loading;
  };
  const early = () => { ensure().catch(() => {}); };
  const openWhenReady = () => {
    if (opening) return;
    opening = true;
    ensure().then((v) => v.openFull()).catch(() => {}).finally(() => { opening = false; });
  };
  const onKey = (e) => {
    if (!isVizKey(e, { open: false, route: document.body.dataset.route })) return;
    e.preventDefault();
    openWhenReady();
  };
  function detach() {
    button?.removeEventListener('click', openWhenReady);
    document.removeEventListener('keydown', onKey);
    for (const t of ['loadstart', 'play']) audio?.removeEventListener(t, early);
  }
  if (button) setIcon('mini-viz', 'equalizer', 'action');
  button?.addEventListener('click', openWhenReady);
  document.addEventListener('keydown', onKey);
  for (const t of ['loadstart', 'play']) audio?.addEventListener(t, early);
  return { ensure, isReady: () => ready !== null, openFull: () => ensure().then((v) => v.full.open()) };
}
