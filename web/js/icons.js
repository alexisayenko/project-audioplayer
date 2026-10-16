const SVG_NS = 'http://www.w3.org/2000/svg';

export const STROKE_WIDTH = 1.8;

export const ICONS = {
  prev: { fill: true, d: '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/><path d="M3 20V4"/>' },
  next: { fill: true, d: '<path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>' },
  play: { fill: true, d: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>' },
  pause: { fill: true, d: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>' },
  more: { fill: true, d: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>' },
  shuffle: { d: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>' },
  repeat: { d: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>' },
  repeatOne: { d: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>' },
  library: { d: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>' },
  genresMap: { d: '<path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/>' },
  genresMapRework: { d: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>' },
  stats: { d: '<circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="18.5" cy="5.5" r=".5" fill="currentColor"/><circle cx="11.5" cy="11.5" r=".5" fill="currentColor"/><circle cx="7.5" cy="16.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="14.5" r=".5" fill="currentColor"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/>' },
  theory: { d: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>' },
  settings: { d: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>' },
  playlist: { d: '<path d="M16 5H3"/><path d="M11 12H3"/><path d="M11 19H3"/><path d="M21 16V5"/><circle cx="18" cy="16" r="3"/>' },
  playlistAdd: { d: '<path d="M16 5H3"/><path d="M11 12H3"/><path d="M16 19H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>' },
  search: { d: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>' },
  clear: { d: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' },
  pencil: { d: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>' },
  info: { d: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>' },
  check: { d: '<path d="M20 6 9 17l-5-5"/>' },
  plus: { d: '<path d="M5 12h14"/><path d="M12 5v14"/>' },
  minus: { d: '<path d="M5 12h14"/>' },
  chevron: { d: '<path d="m6 9 6 6 6-6"/>' },
  chevronLeft: { d: '<path d="m15 18-6-6 6-6"/>' },
  download: { d: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>' },
  listAdd: { d: '<path d="M16 5H3"/><path d="M11 12H3"/><path d="M16 19H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>' },
  listCheck: { d: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>' },
  warning: { d: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>' },
  share: { d: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>' },
  volume: { d: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>' },
  volumeMute: { d: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>' },
  equalizer: { d: '<path d="M5 21v-6"/><path d="M12 21V3"/><path d="M19 21V9"/>' },
  terrain: { d: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>' },
  link: { d: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' },
  music: { d: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
  crosshair: { d: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>' },
  maximize: { d: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>' },
  externalLink: { d: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' },
  playOutline: { d: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>' },
  chevronUp: { d: '<path d="m18 15-6-6-6 6"/>' },
  ring: { d: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.5"/><path d="M12 18.5V21"/><path d="M3 12h2.5"/><path d="M18.5 12H21"/><path d="m16.6 7.4 1.8-1.8"/><path d="m16.6 16.6 1.8 1.8"/><path d="m7.4 16.6-1.8 1.8"/><path d="m7.4 7.4-1.8-1.8"/>' },
  mark: { d: '<circle cx="12" cy="12" r="10.6" style="fill:none;stroke:var(--copper);stroke-width:1"/><circle cx="12" cy="12" r="9.6" style="fill:var(--vinyl);stroke:none"/><circle cx="12" cy="12" r="3.9" style="fill:var(--accent);stroke:none"/><path d="M9.6 10.8h4.8M9.4 13.2h5.2" style="fill:none;stroke:var(--on-accent);stroke-width:1.3"/><circle cx="12" cy="12" r=".6" style="fill:var(--surface);stroke:none"/>' },
  synthwave: { d: '<path d="M7 12a5 5 0 0 1 10 0"/><path d="M3 12h18"/><path d="M5 16h14"/><path d="M8 20h8"/>' },
};

export function icon(name, size = 'nav') {
  const def = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (typeof size === 'number') {
    svg.setAttribute('class', 'ic');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
  } else {
    svg.setAttribute('class', `ic ic-${size}`);
  }
  svg.setAttribute('fill', def.fill ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', STROKE_WIDTH);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = def.d;
  return svg;
}
