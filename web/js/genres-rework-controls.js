import { el } from './dom.js';
import { icon } from './icons.js';
import { VIEWS } from './genres-rework-storage.js';

const toolButton = (cls, attrs, label) => el('button', { class: cls, type: 'button', ...attrs }, label);

function viewControls(init, on) {
  const viewBtns = VIEWS.map((v) => el('button', {
    class: 'gm-tbtn', type: 'button', 'data-view': v, 'aria-pressed': String(v === init.kind), onclick: () => on.setView(v),
  }, v === 'graph' ? 'Graph' : 'Radial'));
  const viewRow = el('div', { class: 'gmr-view-row', role: 'group', 'aria-label': 'Map view' }, ...viewBtns);
  const libBtn = toolButton('gm-tbtn gmr-lib', {
    'aria-pressed': 'false', hidden: init.kind !== 'graph', title: 'Also show the genres that have no song in your library (this visit only)', onclick: on.toggleAllGenres,
  }, 'All genres');
  return { viewBtns, viewRow, libBtn };
}

function drillControls(init, on) {
  const drillBtn = toolButton('gm-tbtn gmr-drill', {
    'aria-pressed': String(init.drill), hidden: init.kind !== 'graph', title: 'Show the families first and open a genre to see the genres below it (Esc collapses everything)', onclick: on.toggleDrill,
  }, 'Drill-down');
  const collapseMapBtn = toolButton('gm-tbtn gmr-collapse-map', {
    hidden: init.kind !== 'graph' || !init.drill, 'aria-label': 'Collapse all branches on the map', title: 'Back to the families only (Esc)', onclick: on.collapseMap,
  }, 'Collapse all');
  return { drillBtn, collapseMapBtn };
}

function switchControls(init, on) {
  const fusionBtn = toolButton('gm-tbtn gmr-fusion', {
    role: 'switch', 'aria-checked': String(init.fusion), title: 'Also show fusion genres (blues rock, trip hop, ...) under their second family', onclick: on.toggleFusion,
  }, 'Fusion genres');
  const relatedBtn = toolButton('gm-tbtn gmr-fusion gmr-related', {
    role: 'switch', 'aria-checked': String(init.related), title: 'Show related genres (influences, not parents) as faint dotted lines', onclick: on.toggleRelated,
  }, 'Related');
  return { fusionBtn, relatedBtn };
}

function layoutControls(init, on) {
  const resetLayoutBtn = toolButton('gm-tbtn gmr-layout', {
    hidden: init.kind !== 'graph', title: 'Place the circles again with the fewest crossing lines', onclick: on.resetLayout,
  }, 'Reset layout');
  const useSavedBtn = toolButton('gm-tbtn gmr-layout', {
    hidden: true, title: 'Go back to the layout saved in the layout file', onclick: on.useSavedLayout,
  }, 'Use saved layout');
  const exportBtn = toolButton('gm-tbtn gmr-layout', {
    hidden: true, title: 'Copy the current circle positions as layout JSON (genre-layout.json)', onclick: on.exportLayout,
  }, 'Export layout');
  return { resetLayoutBtn, useSavedBtn, exportBtn };
}

export function createToolbar(init, on) {
  const legendBtn = toolButton('gm-tbtn', {
    'aria-controls': 'gmr-legend', 'aria-expanded': String(init.legendOpen), onclick: on.toggleLegend,
  }, init.legendOpen ? 'Hide legend' : 'Show legend');
  const nowBtn = el('button', { class: 'gm-tbtn gmr-now', type: 'button', hidden: true, onclick: on.showNowPlaying }, icon('music', 'inline'), 'Now playing');
  return { legendBtn, nowBtn, ...viewControls(init, on), ...drillControls(init, on), ...switchControls(init, on), ...layoutControls(init, on) };
}
