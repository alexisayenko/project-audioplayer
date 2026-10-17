import { icon } from './icons.js';

export const SCROLL_SCREENS = 2;

export function shouldShow(scrollY, viewportHeight) {
  if (!Number.isFinite(scrollY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;
  return scrollY > SCROLL_SCREENS * viewportHeight;
}

let current = null;

export function mountScrollTop(doc = document, win = window) {
  if (current) current();
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'scroll-top';
  btn.setAttribute('aria-label', 'Scroll to top');
  btn.title = 'Scroll to top';
  btn.append(icon('arrowUp', 'action'));

  let queued = false;
  const update = () => {
    queued = false;
    btn.classList.toggle('shown', shouldShow(win.scrollY, win.innerHeight));
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(update);
  };
  const onClick = () => {
    const reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    win.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  btn.addEventListener('click', onClick);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onScroll);
  doc.body.append(btn);
  update();

  const destroy = () => {
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('resize', onScroll);
    btn.removeEventListener('click', onClick);
    btn.remove();
    if (current === destroy) current = null;
  };
  current = destroy;
  return destroy;
}
