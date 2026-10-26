import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const ESBUILD = '0.27.7';
export const TARGET = ['es2022', 'chrome111', 'safari16.4', 'firefox113'];

function npmCli() {
  const bin = dirname(process.execPath);
  const candidates = [
    join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/lib/node_modules/npm/bin/npm-cli.js',
    '/usr/share/nodejs/npm/bin/npm-cli.js',
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`npm-cli.js not found; looked in:\n${candidates.join('\n')}`);
  return found;
}

export function loadEsbuild() {
  const name = `electrophone-esbuild-${ESBUILD}`;
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), name);
  const old = join(tmpdir(), name);
  if (!existsSync(dir) && existsSync(old)) cpSync(old, dir, { recursive: true });
  const pkg = join(dir, 'node_modules', 'esbuild', 'package.json');
  if (!existsSync(pkg) || JSON.parse(readFileSync(pkg, 'utf8')).version !== ESBUILD) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"private":true}\n');
    execFileSync(process.execPath, [npmCli(), 'install','--prefix', dir, '--no-audit', '--no-fund', '--loglevel=error', `esbuild@${ESBUILD}`], { stdio: 'inherit' });
  }
  const esbuild = createRequire(join(dir, 'x.js'))('esbuild');
  if (esbuild.version !== ESBUILD) throw new Error(`esbuild ${esbuild.version} is installed, ${ESBUILD} is pinned`);
  return esbuild;
}
