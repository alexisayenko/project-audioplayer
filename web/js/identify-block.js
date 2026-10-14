import { api } from './api.js';
import { el } from './dom.js';
import { disabledReason, statusLine, yearAction, linkPlan, suggestedTags } from './identify-plan.js';

export function identifyBlock({ id = null, audio = false, editor, getYear, setYear, applyLinks }) {
  const btn = el('button', { class: 'btn outline small', type: 'button' }, 'Identify from audio');
  const msg = el('p', { class: 't-caption muted', role: 'status' });
  const actions = el('div', { class: 'row' });
  const node = el('div', { class: 'identify-block' }, btn, msg, actions);
  let available = null;
  let gen = 0;

  const paintButton = () => {
    const why = disabledReason({ id, audio, available });
    btn.disabled = !!why;
    btn.title = why || 'Fingerprint the audio and look it up in AcoustID, MusicBrainz and Discogs. Nothing is applied until you click a suggestion.';
  };

  const show = (res) => {
    msg.textContent = statusLine(res);
    editor.setSuggested(suggestedTags(res), { all: true });
    const year = yearAction(res, getYear());
    const links = linkPlan(res);
    const buttons = [];
    if (year) buttons.push(el('button', { class: 'btn outline small', type: 'button', onclick: () => setYear(year) }, `Apply year ${year}`));
    if (links) buttons.push(el('button', { class: 'btn outline small', type: 'button', onclick: () => applyLinks(links) }, 'Apply links'));
    actions.replaceChildren(...buttons);
  };

  btn.addEventListener('click', async () => {
    const mine = ++gen;
    btn.disabled = true;
    btn.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Identifying...');
    try {
      const res = await api.identify(id);
      if (mine === gen) show(res);
    } catch (ex) {
      if (mine === gen) msg.textContent = ex.message || 'Couldn\'t identify';
    } finally {
      if (mine === gen) {
        btn.textContent = 'Identify from audio';
        paintButton();
      }
    }
  });

  paintButton();
  if (id && audio) {
    api.identifyState(id).then((res) => {
      available = res?.available || null;
      paintButton();
      if (res?.status === 'ok' || res?.status === 'no_match') show(res);
    }).catch(() => {});
  }

  return { node, reset() { gen += 1; msg.textContent = ''; actions.replaceChildren(); }, destroy() { gen += 1; } };
}
