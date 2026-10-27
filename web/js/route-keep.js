/** True when a hash change stays inside the Library (Songs, Albums, Drafts): the mounted page is retargeted, not rebuilt. */
export function keepsLibrary({ soft, name, current, cleanup, hasContent }) {
  return !!soft && name === 'library' && current === 'library' && typeof cleanup?.retarget === 'function' && !!hasContent;
}

const WARM_UI = { 'library/albums': 'albums', 'library/drafts': 'drafts' };

/** The lazy UI module a sidebar item needs, so hovering or focusing it can start the download before the click. */
export const warmModule = (route) => WARM_UI[route] || null;

export function warmOnIntent(nav, load) {
  const warm = (e) => {
    const name = warmModule(e.target?.closest?.('a')?.dataset?.route);
    if (name) Promise.resolve(load(name)).catch(() => {});
  };
  for (const type of ['pointerover', 'focusin', 'touchstart']) nav?.addEventListener(type, warm, { passive: true });
  return warm;
}
