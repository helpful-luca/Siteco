// Copies the built app to ~/Applications (replacing an older copy). `ditto` keeps the bundle's
// signature and symlinks intact. A locally built app carries no quarantine flag, so Gatekeeper
// opens it without a prompt; distributing it would need a Developer ID signature and notarization.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = 'Siteco Document Chat.app';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', APP);
const targetDir = join(homedir(), 'Applications');
const target = join(targetDir, APP);

if (!existsSync(source)) {
  console.error(`No build at ${source}. Run "npm run app:build" first.`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
rmSync(target, { recursive: true, force: true });
execFileSync('/usr/bin/ditto', [source, target]);
console.log(`Installed: ${target}`);
