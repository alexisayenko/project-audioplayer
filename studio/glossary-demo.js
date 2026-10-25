import { el } from '../web/js/dom.js';

export const pageLink = (term) => (term.demo?.page ? [el('a', { href: `#/${term.demo.page}` }, `${term.demo.label} page →`)] : []);

export const demoLink = (term) => (term.demo?.type === 'link' ? [el('a', { class: 'btn outline small gl-demo-link', href: term.demo.href }, `${term.demo.label} →`)] : []);
