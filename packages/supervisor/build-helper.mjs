// Builds the supervisor's native helper into dist/helper: native/helper.c on macOS (the Seatbelt backend's process
// scan and the seam suite's probe) and native/helper-linux.c on Linux (the bubblewrap backend's confine, scan and
// probe, #70). Windows has no backend yet.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = process.platform === 'darwin' ? 'native/helper.c' : process.platform === 'linux' ? 'native/helper-linux.c' : undefined;
if (source) {
  mkdirSync(fileURLToPath(new URL('dist/', import.meta.url)), { recursive: true });
  execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', fileURLToPath(new URL('dist/helper', import.meta.url)), fileURLToPath(new URL(source, import.meta.url))], { stdio: 'inherit' });
}
