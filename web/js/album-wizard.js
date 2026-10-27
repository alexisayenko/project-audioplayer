import { store } from './store.js';
import { el } from './dom.js';
import { dialogHead } from './edit-dialog.js';
import { backdropClose } from './dialog-backdrop.js';
import { ALBUMS_CHANGED } from './album-candidates.js';
import { STEPS, STEP_LABEL, newDraft, beforeStep, OFFLINE_MESSAGE } from './album-wizard-model.js';
import { mountLink } from './album-wizard-link.js';
import { mountDetails } from './album-wizard-details.js';
import { mountPick } from './album-wizard-pick.js';
import { mountReview } from './album-wizard-review.js';
import { mountRun } from './album-wizard-run.js';

const SUBTITLE = 'From a YouTube playlist or a video with time codes. Nothing is saved until the last step.';

export function openAddAlbum(opener = null, { pollMs } = {}) {
  const dlg = document.getElementById('add-dialog');
  const draft = newDraft();
  let alive = true;
  let current = null;
  let working = false;
  let onBusy = null;

  const stepLine = el('p', { class: 't-caption muted wiz-stepline', role: 'status' });
  const dots = el('ol', { class: 'wiz-dots', 'aria-hidden': 'true' }, ...STEPS.map((s) => el('li', { 'data-step': s })));
  const heading = el('h3', { class: 't-headline wiz-heading', tabindex: '-1' });
  const message = el('div', { class: 'wiz-msg', role: 'alert' });
  const busyLine = el('p', { class: 'muted t-subhead wiz-busy', role: 'status', hidden: true });
  const body = el('div', { class: 'wiz-body' });
  const back = el('button', { class: 'btn outline wiz-back', type: 'button' }, 'Back');
  const next = el('button', { class: 'btn primary glow wiz-next', type: 'button' }, 'Next');
  const foot = el('div', { class: 'add-foot wiz-foot' }, back, next);

  const say = (text, link, hint) => {
    message.replaceChildren(
      text ? el('p', { class: 'msg error' }, text, ...(link ? [' ', link] : [])) : '',
      hint ? el('p', { class: 'muted t-caption' }, hint) : '');
  };

  const ctx = {
    draft, say,
    live: () => alive,
    touch: () => { draft.edited = true; },
    setNext: (label, disabled = false) => { next.textContent = label; next.disabled = disabled || working; next.dataset.blocked = String(disabled); },
    busy: (on, text = '') => {
      working = on;
      busyLine.hidden = !on;
      busyLine.textContent = on ? text : '';
      back.disabled = on;
      next.disabled = on || next.dataset.blocked === 'true';
      next.toggleAttribute('aria-busy', on);
      onBusy?.(on);
    },
    watchBusy: (fn) => { onBusy = fn; },
    go: (step) => show(step),
    submit: () => { if (!next.disabled && !working) void run(); },
    openExisting: (id) => el('button', { class: 'link-btn t-caption', type: 'button', onclick: () => { dlg.close(); location.hash = `#/library/albums/${encodeURIComponent(id)}`; } }, 'Open it'),
    finish: (albumId, open) => {
      dlg.close();
      window.dispatchEvent(new Event(ALBUMS_CHANGED));
      void store.refresh().catch(() => {});
      if (open && albumId) location.hash = `#/library/albums/${encodeURIComponent(albumId)}`;
    },
  };

  const MOUNT = {
    link: mountLink, details: mountDetails, discogs: mountPick, review: mountReview, run: (c) => mountRun(c, { pollMs }),
  };

  function paintSteps(step) {
    const at = STEPS.indexOf(step);
    stepLine.textContent = `Step ${at + 1} of ${STEPS.length} · ${STEP_LABEL[step]}`;
    heading.textContent = STEP_LABEL[step];
    dots.querySelectorAll('li').forEach((li, i) => {
      li.className = [i < at ? 'done' : '', i === at ? 'current' : '', STEPS[i] === 'discogs' && draft.discogs.auto && at > i ? 'skipped' : ''].filter(Boolean).join(' ');
      if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  function show(step) {
    current?.dispose?.();
    draft.step = step;
    say('');
    next.dataset.blocked = 'false';
    onBusy = null;
    ctx.busy(false);
    current =MOUNT[step](ctx);
    body.replaceChildren(current.node);
    paintSteps(step);
    back.hidden = !current.back;
    next.hidden = !!current.hideNext;
    if (step !== 'review') ctx.setNext(current.nextLabel || 'Next', false);
    body.scrollTop = 0;
    dlg.scrollTop = 0;
    if (current.focus && step !== 'review') current.focus(); else heading.focus();
  }

  async function run() {
    if (working || !current?.run) return;
    await current.run();
  }

  next.addEventListener('click', () => { void run(); });
  back.addEventListener('click', () => {
    if (working) return;
    show(beforeStep(draft, draft.step));
  });
  const onOffline = () => say(OFFLINE_MESSAGE);
  const onOnline = () => { if (message.textContent === OFFLINE_MESSAGE) say(''); };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  dlg.onclose = () => {
    alive = false;
    current?.dispose?.();
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    dlg.replaceChildren();
    dlg.onclose = null;
    dlg.onclick = null;
    dlg.onmousedown = null;
    if (opener?.isConnected) opener.focus();
  };
  dlg.replaceChildren(
    dialogHead('Add album', SUBTITLE, () => dlg.close()),
    el('div', { class: 'wiz-top' }, stepLine, dots),
    heading, body, busyLine, message, foot);
  backdropClose(dlg, { dirty: () => !!draft.preview || !!dlg.querySelector('#wiz-url')?.value.trim() });
  dlg.showModal();
  show('link');
  return dlg;
}
