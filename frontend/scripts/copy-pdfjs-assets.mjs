// Copies the PDF.js files the viewer loads at runtime (character maps, standard fonts, image
// decoders) from the installed pdfjs-dist into public/pdfjs, so they come from our own origin and
// always match the worker's version. Runs before `dev` and `build`; the output is not committed.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
const target = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'pdfjs');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(path.join(source, folder), path.join(target, folder), { recursive: true });
}
