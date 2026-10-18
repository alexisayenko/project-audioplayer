import { el } from './dom.js';

const state = { guest: false, audio: true, owner: 'Alex' };

const CAPS = {
  edit: false, add: false, remove: false, download: false, fetch: false, identify: false, tags: false, autodl: false, fill: false,
  play: true, queue: true, filter: true, search: true, sort: true, card: true,
};

export const isGuest = () => state.guest;

export const streamable = () => !state.guest || state.audio;

export const ownerLabel = () => state.owner;

export function setGuest(me) {
  state.guest = true;
  state.audio = me?.audio !== false;
  state.owner = me?.owner_label || 'Alex';
}

export function clearGuest() {
  state.guest = false;
  state.audio = true;
  state.owner = 'Alex';
}

export function can(cap) {
  return state.guest ? CAPS[cap] === true : true;
}

export const BANNER_ID = 'guest-banner';

export function bannerText() {
  return `Viewing ${state.owner}'s library (read-only). Sign in to build your own`;
}

export function banner(onSignIn) {
  if (!state.guest) return null;
  return el('div', { id: BANNER_ID, class: 'guest-banner t-subhead', role: 'note' },
    el('span', {}, bannerText()),
    el('button', { class: 'btn outline small', type: 'button', onclick: onSignIn }, 'Sign in'));
}

export function syncBanner(stage, before, onSignIn) {
  stage.querySelector?.(`#${BANNER_ID}`)?.remove();
  const node = banner(onSignIn);
  if (node) stage.insertBefore(node, before); // NOSONAR before may be null, which insertBefore accepts and before.before would not
  return node;
}
