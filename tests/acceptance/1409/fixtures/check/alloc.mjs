// AC3's check command, `node alloc.mjs`: allocates 512 MiB in 1 MiB buffers of random bytes, so the memory is
// resident and can't be compressed, holds it for 10 s, then exits 0. Only a stop ends it sooner.
import { randomFillSync } from 'node:crypto';

const held = [];
for (let i = 0; i < 512; i++) held.push(randomFillSync(Buffer.allocUnsafeSlow(1024 * 1024)));
console.log(`allocated ${held.length} MiB`);
setTimeout(() => process.exit(0), 10_000);
