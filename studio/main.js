import { el } from '../web/js/dom.js';
import { studioTabs } from '../web/js/studio-tabs.js';
import { mountTools } from '../web/js/studio-tools.js';
import { mountSimple } from '../web/js/simple-tone.js';
import { TABS, tabFromHash } from './routes.js';

const MOUNT = {
  analyze: (pane) => mountTools(pane, { standalone: true }),
  synthesize: (pane) => mountSimple(pane),
};

const root = document.getElementById('app');
let stop = null;

function show() {
  const tab = tabFromHash(globalThis.location.hash);
  stop?.();
  const tabs = studioTabs(tab, (hash) => { globalThis.location.hash = hash; }, TABS);
  const panes = TABS.map((t) => el('div', { class: 'stu', id: `stu-${t.id}`, role: 'tabpanel', 'aria-labelledby': `stu-tab-${t.id}`, hidden: t.id !== tab }));
  root.replaceChildren(tabs.bar, ...panes);
  tabs.restoreFocus();
  stop = MOUNT[tab](panes[TABS.findIndex((t) => t.id === tab)]);
  document.title = `${TABS.find((t) => t.id === tab).label} - Electrophone Studio`;
}

globalThis.addEventListener('hashchange', show);
show();
