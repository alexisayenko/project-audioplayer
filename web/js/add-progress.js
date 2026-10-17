import { el } from './dom.js';
import { icon } from './icons.js';

const MARK = { pending: () => el('span', { class: 'step-dot', 'aria-hidden': 'true' }), current: () => el('span', { class: 'spin', 'aria-hidden': 'true' }), done: () => icon('check', 'inline'), failed: () => icon('warning', 'inline') };

export function fetchSteps(now = () => Date.now()) {
  const live = el('p', { class: 't-caption', role: 'status', 'aria-live': 'polite' }, 'Contacting the server');
  const clock = el('span', { class: 'step-clock t-caption muted', 'aria-hidden': 'true' });
  const list = el('ol', { class: 'fetch-steps-list' });
  const node = el('div', { class: 'fetch-steps' }, el('div', { class: 'fetch-steps-head' }, live, clock), list);
  const rows = new Map();
  const order = [];
  const t0 = now();
  let currentId = null;
  let timer = null;

  const tick = () => { clock.textContent = `${Math.max(0, Math.floor((now() - t0) / 1000))} s`; };
  const paint = (id, state) => {
    const row = rows.get(id);
    row.li.className = `step ${state}`;
    const next = MARK[state]();
    row.mark.replaceWith(next);
    row.mark = next;
    if (state === 'current') row.li.setAttribute('aria-current', 'step'); else row.li.removeAttribute('aria-current');
  };
  const say = (id, text) => { const n = order.indexOf(id) + 1; live.textContent = `Step ${n} of ${order.length}: ${text}`; };

  tick();
  timer = setInterval(tick, 1000);

  return {
    node,
    handle(ev) {
      if (ev.event === 'stages') {
        for (const s of ev.stages) {
          const mark = MARK.pending();
          const li = el('li', { class: 'step pending' }, mark, el('span', { class: 'step-label' }, s.label));
          rows.set(s.id, { li, mark, label: s.label });
          order.push(s.id);
          list.append(li);
        }
      } else if (ev.event === 'stage' && rows.has(ev.id)) {
        if (ev.state === 'start') { currentId = ev.id; paint(ev.id, 'current'); say(ev.id, rows.get(ev.id).label); }
        else if (ev.state === 'done') { paint(ev.id, 'done'); if (currentId === ev.id) currentId = null; }
      }
    },
    fail() {
      this.stop();
      if (currentId && rows.has(currentId)) { paint(currentId, 'failed'); live.textContent = `Stopped at: ${rows.get(currentId).label}`; }
      else live.textContent = 'Could not reach the server';
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      tick();
    },
  };
}
