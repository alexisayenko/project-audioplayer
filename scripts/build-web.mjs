#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESBUILD, TARGET, loadEsbuild } from './build-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const jsDir = join(root, 'js');
const dist = join(root, 'dist');
const ENTRIES = ['app', 'icons', 'viz-timeline-worker'];
const GROUPS = {
  ui: ['song-card', 'add', 'edit-dialog', 'cover-dialog', 'genre-card', 'share-ui', 'share-open', 'share', 'player-tag-picker', 'drafts', 'albums', 'player-actions', 'library-toolbar', 'playlist-picker', 'update-check', 'stats', 'settings', 'theory', 'playlists', 'studio', 'about', 'features', 'viz-ui'],
  genres: ['genres-rework', 'genres'],
};
const PRELOAD_ORDER = ['lazy-ui', 'lazy-genres'];
const posix = (p) => p.split(sep).join('/');

function stylesheets() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
}

function sourceDigest(sheets) {
  const modules = readdirSync(jsDir, { recursive: true }).map(posix).filter((p) => p.endsWith('.js')).map((p) => `js/${p}`).sort();
  const hash = createHash('sha256');
  for (const rel of [...modules, ...sheets]) {
    hash.update(`${rel}\0`);
    hash.update(readFileSync(join(root, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const ident = (name) => name.replaceAll('-', '_');

function lazyGroups() {
  const owner = new Map();
  for (const [group, names] of Object.entries(GROUPS)) {
    for (const name of names) {
      if (!existsSync(join(jsDir, `${name}.js`))) throw new Error(`group ${group} lists missing module ${name}.js`);
      owner.set(name, group);
    }
  }
  const dynamic = /\bimport\(\s*(['"])\.\/([a-z0-9-]+)\.js\1\s*\)/g;
  return {
    name: 'lazy-groups',
    setup(build) {
      build.onResolve({ filter: /^lazy-[a-z]+$/ }, (a) => ({ path: a.path, namespace: 'lazy' }));
      build.onLoad({ filter: /.*/, namespace: 'lazy' }, (a) => ({
        contents: GROUPS[a.path.slice(5)].map((n) => `export * as ${ident(n)} from './${n}.js';`).join('\n'),
        resolveDir: jsDir,
        loader: 'js',
      }));
      build.onLoad({ filter: /\.js$/ }, (a) => {
        if (!a.path.startsWith(jsDir + sep)) return null;
        const source = readFileSync(a.path, 'utf8');
        const contents = source.replace(dynamic, (whole, _q, name) => (owner.has(name) ? `import('lazy-${owner.get(name)}').then((m) => m.${ident(name)})` : whole));
        return { contents, loader: 'js' };
      });
    },
  };
}

function layout(outputs) {
  const imports = (file, kind) => outputs[file].imports.filter((i) => i.kind === kind).map((i) => i.path);
  const entry = (name) => `dist/${name}.js`;
  const closure = (starts, seen = new Set()) => {
    const order = [];
    const queue = [...starts];
    while (queue.length) {
      const f = queue.shift();
      if (seen.has(f)) continue;
      seen.add(f);
      order.push(f);
      queue.push(...imports(f, 'import-statement'));
    }
    return order;
  };
  const seen = new Set();
  const tier1 = closure([entry('app'), entry('icons')], seen);
  const starts = [...new Set(tier1.flatMap((f) => imports(f, 'dynamic-import')))];
  const rank = (f) => { const i = PRELOAD_ORDER.findIndex((n) => f.includes(`/${n}-`)); return i < 0 ? PRELOAD_ORDER.length : i; };
  const lazy = [];
  for (const start of starts.sort((a, b) => rank(a) - rank(b))) lazy.push(...closure([start], seen));
  for (let i = 0; i < lazy.length; i += 1) {
    for (const f of imports(lazy[i], 'dynamic-import')) if (!seen.has(f)) lazy.push(...closure([f], seen));
  }
  return { tier1, tier2: lazy };
}

async function build() {
  const esbuild = loadEsbuild();
  if (esbuild.version !== ESBUILD) throw new Error(`esbuild ${esbuild.version} is installed, ${ESBUILD} is pinned`);
  const sheets = stylesheets();
  const digest = sourceDigest(sheets);
  rmSync(dist, { recursive: true, force: true });
  const result = await esbuild.build({
    entryPoints: ENTRIES.map((n) => join(jsDir, `${n}.js`)),
    outdir: dist,
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: true,
    target: TARGET,
    entryNames: '[name]',
    chunkNames: '[name]-[hash]',
    legalComments: 'none',
    metafile: true,
    plugins: [lazyGroups()],
    logLevel: 'warning',
    absWorkingDir: root,
  });
  const css = sheets.map((href) => readFileSync(join(root, href), 'utf8').replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/g,
    (whole, a, b, c) => {
      const ref = a ?? b ?? c;
      return /^(data:|https?:|\/|#)/.test(ref) ? whole : `url("../${ref}")`;
    },
  )).join('\n');
  const minified = await esbuild.transform(css, { loader: 'css', minify: true, target: TARGET, legalComments: 'none' });
  writeFileSync(join(dist, 'app.css'), minified.code);
  const outputs = result.metafile.outputs;
  const { tier1, tier2 } = layout(outputs);
  const manifest = { esbuild: ESBUILD, sources: digest, stylesheets: sheets, css: 'dist/app.css', entry: 'dist/app.js', icons: 'dist/icons.js', tier1, tier2 };
  writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const bytes = Object.values(outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`web bundle: ${Object.keys(outputs).length} js files (${bytes} bytes), ${tier1.length} startup, ${tier2.length} lazy, css ${minified.code.length} bytes`);
}

function check() {
  const file = join(dist, 'manifest.json');
  if (!existsSync(file)) {
    console.error('web/dist is missing: run node scripts/build-web.mjs and commit web/dist');
    return 1;
  }
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.sources !== sourceDigest(stylesheets())) {
    console.error('web/dist is stale (web/js or a stylesheet changed since the last build): run node scripts/build-web.mjs and commit web/dist');
    return 1;
  }
  const files = [manifest.css, manifest.entry, manifest.icons, ...manifest.tier1, ...manifest.tier2];
  const missing = files.filter((f) => !existsSync(join(root, f)));
  if (missing.length) {
    console.error(`web/dist lacks ${missing.join(', ')}: run node scripts/build-web.mjs and commit web/dist`);
    return 1;
  }
  console.log('web/dist is up to date');
  return 0;
}

if (process.argv.includes('--check')) process.exit(check());
await build();
