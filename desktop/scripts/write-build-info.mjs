// Records the repository root at build time. The app runs `docker compose` there unless the
// person picked another folder (config.json in the app's user data).
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const info = { projectDir: resolve(desktop, '..') };
writeFileSync(join(desktop, 'dist/build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
