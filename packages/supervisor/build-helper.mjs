// Builds the supervisor's native helper into dist/helper: native/helper.c on macOS (the Seatbelt backend's process
// scan and the seam suite's probe), with native/linux.c on Linux (the bubblewrap backend's box and confine, #70).
// Other platforms have no backend yet.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sources = { darwin: ['native/helper.c'], linux: ['native/helper.c', 'native/linux.c'] }[process.platform];
if (sources) {
  mkdirSync(fileURLToPath(new URL('dist/', import.meta.url)), { recursive: true });
  const libs = process.platform === 'linux' ? ['-lutil'] : [];
  execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', fileURLToPath(new URL('dist/helper', import.meta.url)), ...sources.map((s) => fileURLToPath(new URL(s, import.meta.url))), ...libs], { stdio: 'inherit' });
}
