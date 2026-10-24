#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET, loadEsbuild } from './build-lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(repo, 'studio');
const web = join(repo, 'web');
const dist = join(site, 'dist');
const SHEETS = [join(web, 'tokens.css'), join(web, 'style.css'), join(web, 'studio.css'), join(site, 'site.css')];
const FILES = [
  [join(web, 'favicon.svg'), 'favicon.svg'],
  [join(web, 'favicon-32.png'), 'favicon-32.png'],
  [join(web, 'apple-touch-icon.png'), 'apple-touch-icon.png'],
  [join(site, '_headers'), '_headers'],
  [join(site, 'robots.txt'), 'robots.txt'],
];

const short = (data) => createHash('sha256').update(data).digest('hex').slice(0, 8);

function list(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? list(join(dir, e.name), base)
    : [join(dir, e.name).slice(base.length + 1)])).sort();
}

async function build() {
  const esbuild = loadEsbuild();
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const result = await esbuild.build({
    entryPoints: [join(site, 'main.js')],
    outdir: join(dist, 'assets'),
    bundle: true,
    format: 'esm',
    minify: true,
    target: TARGET,
    entryNames: '[name]-[hash]',
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
    absWorkingDir: repo,
  });
  const [js] = Object.keys(result.metafile.outputs).map((p) => p.split('/').pop());
  const css = await esbuild.transform(SHEETS.map((p) => readFileSync(p, 'utf8')).join('\n'), { loader: 'css', minify: true, target: TARGET, legalComments: 'none' });
  const stray = css.code.match(/url\(\s*(?!["']?(?:data:|#))[^)]*\)/g);
  if (stray) throw new Error(`stylesheet references files the site does not ship: ${stray.join(', ')}`);
  const cssName = `site-${short(css.code)}.css`;
  writeFileSync(join(dist, 'assets', cssName), css.code);
  const html = readFileSync(join(site, 'index.html'), 'utf8')
    .replace('<!--STUDIO_CSS-->', `<link rel="stylesheet" href="assets/${cssName}">`)
    .replace('<!--STUDIO_JS-->', `<script type="module" src="assets/${js}"></script>`);
  if (html.includes('<!--STUDIO_')) throw new Error('index.html still has a placeholder');
  writeFileSync(join(dist, 'index.html'), html);
  for (const [from, to] of FILES) copyFileSync(from, join(dist, to));
  const files = list(dist);
  console.log(`studio site: ${files.length} files in studio/dist`);
  for (const f of files) console.log(`  ${f} (${statSync(join(dist, f)).size} bytes)`);
}

await build();
