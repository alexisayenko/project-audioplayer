import { el } from './dom.js';
import { icon } from './icons.js';
import { CIRC, RADIUS } from './dl-progress.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// Builds the indicator for a model from ringModel(); paintRing(node, model) later updates it in place.
export function ringNode(model, onRetry) {
  if (model.actionable) {
    const b = el('button', { class: 'dl-ring failed', type: 'button', onclick: (e) => { e.stopPropagation(); onRetry(); } }, icon('warning', 20));
    b.dataset.role = model.role;
    paintRing(b, model);
    return b;
  }
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  svg.append(
    svgEl('circle', { class: 'trk', cx: 12, cy: 12, r: RADIUS }),
    svgEl('circle', { class: 'arc', cx: 12, cy: 12, r: RADIUS, transform: 'rotate(-90 12 12)', 'stroke-dasharray': CIRC, 'stroke-dashoffset': CIRC }),
    svgEl('text', { x: 12, y: 12.4 }));
  const node = el('span', { class: 'dl-ring', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, svg);
  node.dataset.role = model.role;
  paintRing(node, model);
  return node;
}

// False when the element type no longer fits the model (failed <-> the rest): the caller rebuilds the row.
export function paintRing(node, model) {
  if (node.dataset.role !== model.role) return false;
  node.dataset.state = model.state;
  node.title = model.label;
  if (model.actionable) {
    node.setAttribute('aria-label', model.label);
    return true;
  }
  if (model.now == null) node.removeAttribute('aria-valuenow');
  else node.setAttribute('aria-valuenow', model.now);
  node.setAttribute('aria-valuetext', model.label);
  node.setAttribute('aria-label', model.label);
  node.classList.toggle('idle', model.idle);
  node.classList.toggle('indeterminate', model.indeterminate);
  const arc = node.querySelector('.arc');
  arc.setAttribute('stroke-dasharray', model.dash);
  arc.setAttribute('stroke-dashoffset', model.offset);
  node.querySelector('text').textContent = model.text;
  return true;
}

export function lineNode(model) {
  const n = el('span', { class: 'dl-line', 'aria-hidden': 'true' });
  paintLine(n, model);
  return n;
}

export function paintLine(node, model) {
  node.style.setProperty('--w', `${model.line}%`);
  node.dataset.state = model.state;
}
