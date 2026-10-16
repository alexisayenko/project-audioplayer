import { creditParts, titleLine, versionTooltip, titleNodes, subtitle } from './credits.js';

export function displayTitle(song) {
  const { title, remix } = creditParts(song);
  return { title, remix };
}

export const displayString = titleLine;
export const remixTooltip = versionTooltip;
export const subtitleString = subtitle;
export { titleNodes };
