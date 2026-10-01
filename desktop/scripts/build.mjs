// Builds dist/: compiled main process, the splash page with its icon, and build-info.json.
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// A clean start, so no stale file reaches the app archive.
rmSync(dist, { recursive: true, force: true });

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], { stdio: 'inherit' });

cpSync(join(root, 'static'), join(dist, 'static'), { recursive: true });
const svg = readFileSync(join(root, 'assets/icon.svg'));
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 256 }, font: { loadSystemFonts: false } }).render().asPng();
writeFileSync(join(dist, 'static/icon.png'), png);

// The app runs `docker compose` in the repository it was built from, unless the user picked
// another folder later.
const info = { projectDir: resolve(root, '..') };
writeFileSync(join(dist, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
