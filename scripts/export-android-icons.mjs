#!/usr/bin/env node
// Generates the Android icon set from the web one (AND-014, task-0127 question ND answer 1).
//
// Source: web/js/icons.js (ICONS: 24 grid, stroke 1.8, some filled). Output:
//   android/app/src/main/kotlin/com/alexisayenko/audioplayer/android/ui/icons/Icons.kt
// Bitmap icons (<image>) are skipped. ANDROID_EXTRA holds the few glyphs the Android shell needs and the web set
// lacks (the web draws them another way); they follow the same grid and stroke.
//
// Write:  node scripts/export-android-icons.mjs
// Check:  node scripts/export-android-icons.mjs --check   (exit 1 when the committed file is stale)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS, STROKE_WIDTH } from '../web/js/icons.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'android/app/src/main/kotlin/com/alexisayenko/audioplayer/android/ui/icons/Icons.kt');

const ANDROID_EXTRA = {
  menu: { d: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>' },
  account: { d: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>' },
  nowPlaying: { d: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>' },
  tools: { d: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>' },
  back10: { d: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>' },
  forward10: { d: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>' },
  cloud: { d: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>' },
  phone: { d: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><path d="M12 18h.01"/>' },
  filter: { d: '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>' },
  // Library screen (ui/library): filter chips, the sort control and sheet, the offline banner, the row menu.
  tag: { d: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>' },
  calendar: { d: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>' },
  globe: { d: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>' },
  wifiOff: { d: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>' },
  phoneOff: { d: '<path d="M19 15.5V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5"/><path d="M8.5 2H17a2 2 0 0 1 2 2v6.5"/><path d="M12 18h.01"/><path d="m2 2 20 20"/>' },
  sortCriteria: { d: '<path d="M17.5 9.5V7A3.5 3.5 0 0 0 14 3.5H7A3.5 3.5 0 0 0 3.5 7v8A3.5 3.5 0 0 0 7 18.5h4.5"/><path d="M7.5 8h6M7.5 11.5h4M7.5 15h2"/><path d="M12 12.5h9l-3.4 4.2v3.8l-2.2-1.2v-2.6z"/>' },
  sortAsc: { d: '<path d="M3.5 6.5h3M3.5 12h6M3.5 17.5h9"/><path d="M18 19.5v-15M14.5 8 18 4.5 21.5 8"/>' },
  sortDesc: { d: '<path d="M3.5 6.5h9M3.5 12h6M3.5 17.5h3"/><path d="M18 4.5v15M14.5 16l3.5 3.5 3.5-3.5"/>' },
  clock: { d: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' },
  textLetters: { d: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>' },
  metronome: { d: '<path d="M9.5 3h5l4.5 18H5z"/><path d="M6.5 15h11"/><path d="m12 15 5-9"/>' },
  timer: { d: '<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>' },
  headphones: { d: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>' },
};

const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return String(Math.round(n * 1000) / 1000);
};

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function rectPath(a) {
  const x = Number(a.x ?? 0), y = Number(a.y ?? 0), w = Number(a.width), h = Number(a.height);
  let rx = Number(a.rx ?? a.ry ?? 0), ry = Number(a.ry ?? a.rx ?? 0);
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (!rx || !ry) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
  return `M${num(x + rx)} ${num(y)}h${num(w - 2 * rx)}a${num(rx)} ${num(ry)} 0 0 1 ${num(rx)} ${num(ry)}v${num(h - 2 * ry)}` +
    `a${num(rx)} ${num(ry)} 0 0 1 ${num(-rx)} ${num(ry)}h${num(-(w - 2 * rx))}a${num(rx)} ${num(ry)} 0 0 1 ${num(-rx)} ${num(-ry)}` +
    `v${num(-(h - 2 * ry))}a${num(rx)} ${num(ry)} 0 0 1 ${num(rx)} ${num(-ry)}Z`;
}

function circlePath(a) {
  const cx = Number(a.cx), cy = Number(a.cy), r = Number(a.r);
  return `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`;
}

/** One icon definition -> [{ d, fill, stroke }] or null when it holds a bitmap. */
function parts(def) {
  if (def.d.includes('<image')) return null;
  const out = [];
  for (const m of def.d.matchAll(/<(path|rect|circle|line)\b([^>]*)\/?>/g)) {
    const a = attrs(m[2]);
    let d;
    if (m[1] === 'path') d = a.d;
    else if (m[1] === 'rect') d = rectPath(a);
    else if (m[1] === 'circle') d = circlePath(a);
    else d = `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    const fill = a.fill !== undefined ? a.fill !== 'none' : !!def.fill;
    const stroke = a.stroke !== undefined ? a.stroke !== 'none' : true;
    out.push({ d, fill, stroke });
  }
  const known = (def.d.match(/<[a-z]+/g) || []).length;
  if (known !== out.length) throw new Error(`unsupported SVG element in: ${def.d}`);
  return out;
}

function kotlin() {
  const lines = [
    '// GENERATED by scripts/export-android-icons.mjs from web/js/icons.js — do not edit.',
    '',
    'package com.alexisayenko.audioplayer.android.ui.icons',
    '',
    'import androidx.compose.ui.graphics.vector.ImageVector',
    '',
    '/** The Electrophone icon set: the web icons on a 24 grid, tinted where they are drawn (see DSIcon). */',
    'object Icons {',
    `    const val STROKE_WIDTH = ${STROKE_WIDTH}f`,
    '',
  ];
  const skipped = [];
  const all = { ...ICONS, ...ANDROID_EXTRA };
  for (const [name, def] of Object.entries(all)) {
    const ps = parts(def);
    if (!ps) { skipped.push(name); continue; }
    lines.push(`    val ${name}: ImageVector by lazy {`);
    lines.push(`        dsIconVector("${name}") {`);
    for (const p of ps) lines.push(`            part("${p.d}", fill = ${p.fill}, stroke = ${p.stroke})`);
    lines.push('        }', '    }', '');
  }
  lines.pop();
  lines.push('}');
  return { text: lines.join('\n') + '\n', skipped };
}

const { text, skipped } = kotlin();
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.log('STALE android icons: run node scripts/export-android-icons.mjs');
    process.exit(1);
  }
  console.log('ok: android icons match web/js/icons.js');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT.replace(ROOT + '/', '')} (${text.match(/by lazy/g).length} icons; skipped bitmaps: ${skipped.join(', ') || 'none'})`);
}
