import { creditParts } from './credits.js';

export function displayTitle(song) {
  const { title, remix } = creditParts(song);
  return { title, remix };
}

export { titleLine as displayString, versionTooltip as remixTooltip, subtitle as subtitleString, titleNodes } from './credits.js';
