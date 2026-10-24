// Builds the supervisor's native helper (native/helper.c) into dist/helper, on macOS only: the Seatbelt
// backend's process scan and the seam suite's probe. Other platforms have no backend yet (#70).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin') {
  mkdirSync(fileURLToPath(new URL('dist/', import.meta.url)), { recursive: true });
  execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', fileURLToPath(new URL('dist/helper', import.meta.url)), fileURLToPath(new URL('native/helper.c', import.meta.url))], { stdio: 'inherit' });
}
