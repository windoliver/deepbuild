// A plain allocator (README, The fixture programs): `node alloc.mjs <MiB> <hold ms>` allocates <MiB> in 1 MiB buffers of
// random bytes (resident, not compressible), holds them for <hold ms>, prints `allocated <MiB> MiB` and exits 0. AC2 runs
// it as a command through the hub, inside the supervisor's sandbox and in a sandbox of its own; AC9 runs it under the
// supervisor while it counts a scan's process starts.
import { randomFillSync } from 'node:crypto';

const [mib, hold] = process.argv.slice(2).map(Number);
const held = [];
for (let i = 0; i < mib; i++) held.push(randomFillSync(Buffer.allocUnsafeSlow(1024 * 1024)));
setTimeout(() => {
  console.log(`allocated ${held.length} MiB`);
  process.exit(0);
}, hold);
