// Copies the splash page to dist/static and renders the app icon for it (no external resources).
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
cpSync(join(root, 'static'), join(root, 'dist/static'), { recursive: true });
const svg = readFileSync(join(root, 'assets/icon.svg'));
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 256 }, font: { loadSystemFonts: false } }).render().asPng();
writeFileSync(join(root, 'dist/static/icon.png'), png);
