// Renders assets/icon.svg to build/icon.icns (iconutil, macOS) for electron-builder.
// resvg is pinned in package.json, so the output is the same on every machine.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/icon.svg'));

function render(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } })
    .render()
    .asPng();
}

const work = mkdtempSync(join(tmpdir(), 'docchat-icon-'));
try {
  const iconset = join(work, 'icon.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), render(size));
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), render(size * 2));
  }
  mkdirSync(join(root, 'build'), { recursive: true });
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')]);
  writeFileSync(join(root, 'build/icon.png'), render(1024));
  console.log('icon: build/icon.icns, build/icon.png');
} finally {
  rmSync(work, { recursive: true, force: true });
}
