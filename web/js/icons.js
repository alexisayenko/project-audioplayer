const SVG_NS = 'http://www.w3.org/2000/svg';

export const SHUFFLE_D = 'M3 7h2.5C9.5 7 10 10 12 12S14.5 17 18.5 17H21M18 14.5l3 2.5-3 2.5M3 17h2.5C8.3 17 9.38 15.53 10.47 13.96M13.53 10.04C14.62 8.47 15.7 7 18.5 7H21M18 4.5l3 2.5-3 2.5';
export const LOOP_D = 'M3 11V8.5a4 4 0 014-4h13.5M17.5 2l3 2.5-3 2.5M21 13v2.5a4 4 0 01-4 4H3.5M6.5 17l-3 2.5 3 2.5';
export const NUMERAL_ONE_BBOX = { x: 9, y: 7.5, w: 6, h: 9 };
export const NUMERAL_ONE_D = 'M11.8 7.5H14V14.8H15V16.5H9V14.8H11.8V10.4L9.4 12V9.9Z';

export const ICONS = {
  prev: { fill: true, d: '<path d="M6 5h2v14H6zm13 0v14l-10-7z"/>' },
  next: { fill: true, d: '<path d="M16 5h2v14h-2zM5 5l10 7-10 7z"/>' },
  play: { fill: true, d: '<path d="M7 5l11 7-11 7z"/>' },
  pause: { fill: true, d: '<path d="M7 5h4v14H7zm6 0h4v14h-4z"/>' },
  shuffle: { d: `<path d="${SHUFFLE_D}"/>`, width: 2 },
  repeat: { d: `<path d="${LOOP_D}"/>`, width: 2 },
  repeatOne: { d: `<path d="${LOOP_D}"/><path d="${NUMERAL_ONE_D}" fill="currentColor" stroke="none"/>`, width: 2 },
  library: { d: '<path d="M5 4v16M10 4v16M15 4v16M20 4v16"/>' },
  settings: { d: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>' },
  search: { d: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>' },
  clear: { d: '<path d="M6 6l12 12M18 6L6 18"/>', width: 2 },
  pencil: { d: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1zM14 7l3 3"/>', width: 1.8 },
  info: { d: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6"/>', width: 2 },
  check: { d: '<path d="M5 12.5l4.5 4.5L19 7"/>', width: 2.2 },
  plus: { d: '<path d="M12 5v14M5 12h14"/>', width: 2.2 },
  chevron: { d: '<path d="M6 9l6 6 6-6"/>', width: 2 },
  download: { d: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>', width: 2 },
  locate: { d: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', width: 1.8 },
  listAdd: { d: '<path d="M4 7h11M4 12h8M4 17h8M18 12v7M14.5 15.5h7"/>', width: 1.8 },
  listCheck: { d: '<path d="M4 7h11M4 12h6M4 17h6M13 16l3 3 5-6"/>', width: 1.8 },
  warning: { d: '<path d="M12 4l9.5 16h-19zM12 10v4.5M12 17.3v.2"/>', width: 1.8 },
  share: { d: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>', width: 1.8 },
  volume: { d: '<path d="M4 9.5v5h3.5l5 4v-13l-5 4z"/><path d="M16 9a4 4 0 010 6M18.6 6.4a8 8 0 010 11.2"/>', width: 1.8 },
  volumeMute: { d: '<path d="M4 9.5v5h3.5l5 4v-13l-5 4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>', width: 1.8 },
  equalizer: { d: '<path d="M6 20V11M12 20V4M18 20v-6"/>', width: 2.4 },
  ring: { d: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', width: 1.8 },
  synthwave: { d: '<circle cx="12" cy="9" r="4"/><path d="M2 14h20M4 18h16M7 21h10"/>', width: 1.8 },
  terrain: { d: '<path d="M3 18l4-5 3 3 4-7 3 4 4-5M3 21h18"/>', width: 1.8 },
  link: { d: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>', width: 2 },
  more: { fill: true, d: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>' },
};

export function icon(name, size = 20) {
  const def = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  if (def.fill) {
    svg.setAttribute('fill', 'currentColor');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', def.width || 1.8);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.innerHTML = def.d;
  return svg;
}
